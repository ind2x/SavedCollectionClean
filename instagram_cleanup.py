"""선택한 Instagram 컬렉션 전체 저장 해제 후 빈 컬렉션 삭제. AI 호출 없음."""

import sys
from pathlib import Path

# 사용자 실행 파일 옆에 개발용 캐시가 생기지 않도록 프로젝트 내부로 모은다.
sys.pycache_prefix = str(Path(__file__).resolve().parent / "development/__pycache__")

import argparse
import json
import os
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit


BASE = "https://www.instagram.com"
EMPTY_MESSAGE = "컬렉션에 사진과 동영상을 저장해보세요."
UNSAVE_PROMPT = "저장된 항목과 컬렉션에서 삭제하시겠어요?"
POST_PATH = re.compile(r"^/(?:[\w.]+/)?(?:p|reel)/([\w-]+)/?$")
ACCOUNT = re.compile(r"[A-Za-z0-9._]{1,30}")


class StopCleanup(RuntimeError):
    pass


@dataclass(frozen=True)
class Collection:
    name: str
    id: str
    url: str


def post_id(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "www.instagram.com":
        raise StopCleanup("Instagram 게시글 URL이 아닙니다.")
    match = POST_PATH.fullmatch(parsed.path)
    if not match:
        raise StopCleanup("인식할 수 없는 게시글 경로입니다.")
    return match[1]


def collection_from_link(account, href, name):
    parsed = urlsplit(urljoin(BASE, href))
    pattern = rf"/{re.escape(account)}/saved/(?:[^/]+/)?(\d+)/?"
    match = re.fullmatch(pattern, parsed.path)
    if parsed.hostname != "www.instagram.com" or not match:
        return None
    label = name.strip()
    if not label:
        raise StopCleanup("이름을 확인할 수 없는 컬렉션 카드입니다.")
    return Collection(label, match[1], BASE + parsed.path)


def select_collections(available, names, ask=input):
    selected = []
    for name in dict.fromkeys(n.strip() for n in names if n.strip()):
        matches = [c for c in available if c.name == name]
        if not matches:
            raise StopCleanup(f"컬렉션을 찾지 못했습니다: {name}")
        if len(matches) > 1:
            print(f"같은 이름의 컬렉션이 여러 개입니다: {name}")
            for number, item in enumerate(matches, 1):
                print(f"  {number}. ID {item.id} — {item.url}")
            try:
                number = int(ask("선택할 번호: "))
            except ValueError as error:
                raise StopCleanup("올바른 번호가 아닙니다.") from error
            if not 1 <= number <= len(matches):
                raise StopCleanup("선택 범위를 벗어났습니다.")
            matches = [matches[number - 1]]
        selected.append(matches[0])
    if not selected:
        raise StopCleanup("대상 컬렉션을 입력해 주세요.")
    return selected


class Journal:
    def __init__(self, path, account):
        self.path = path
        self.account = account
        self.run = uuid.uuid4().hex
        self.results = Counter()
        self.posts = {}
        self.collection_results = {}
        self.collection_errors = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, event, collection=None, url=None, **details):
        descriptions = {
            "approved": "실행 승인",
            "collection_started": "컬렉션 정리 시작",
            "pending": "게시글 저장 해제 시작",
            "unsaved": "게시글 저장 해제 완료",
            "already_unsaved": "이미 저장 해제된 게시글",
            "unknown": "게시글 처리 결과 미확정",
            "empty_verified": "빈 컬렉션 확인",
            "collection_delete_pending": "빈 컬렉션 삭제 시작",
            "deleted_verified": "컬렉션 삭제 확인 완료",
            "failed": "컬렉션 처리 실패",
            "interrupted": "사용자가 실행을 중단함",
        }
        message = descriptions.get(event, event)
        if collection:
            message = f"[{collection.name}] {message}"
        elif event == "approved":
            message += ": " + ", ".join(item["name"] for item in details.get("collections", []))
        if url:
            message += f" (게시글 ID: {post_id(url)})"
        if details.get("reason"):
            message += ": " + details["reason"]
        row = {
            "message": message,
            "time": datetime.now(timezone.utc).isoformat(),
            "run": self.run,
            "account": self.account,
            "event": event,
            **details,
        }
        if collection:
            row.update(collection=collection.name, collection_id=collection.id)
        if url:
            row.update(url=url, post_id=post_id(url))
        # 상태 변경 전 기록이 디스크에 남아야 중단 후 미확정 건을 찾을 수 있다.
        with self.path.open("a", encoding="utf-8") as output:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
            output.flush()
            os.fsync(output.fileno())
        self.results[event] += 1
        if url and event in ("unsaved", "already_unsaved") and self.posts.get(post_id(url)) != "unsaved":
            self.posts[post_id(url)] = event
        if event == "approved":
            self.collection_results = {c["id"]: (c["name"], "not_started") for c in details.get("collections", [])}
        if collection and event in ("collection_started", "deleted_verified", "failed"):
            self.collection_results[collection.id] = (collection.name, event)
        if collection and event == "failed":
            self.collection_errors[collection.id] = details.get("reason", "원인 미기록")
        return message

    def summary(self):
        states = {"deleted_verified": "컬렉션 삭제 완료", "failed": "실패", "not_started": "미착수", "collection_started": "진행 중 중단"}
        lines = [f"계정: {self.account}", "이번 실행 결과:"]
        for collection_id, (name, result) in self.collection_results.items():
            lines.append(f"  {name}: {states.get(result, '미완료')}")
            if collection_id in self.collection_errors:
                lines.append(f"    원인: {self.collection_errors[collection_id]}")
        counts = Counter(self.posts.values())
        lines.append(f"  고유 게시글: 해제 {counts['unsaved']}건, 이미 해제됨 {counts['already_unsaved']}건")
        lines.append(f"  상세 기록: {self.path.resolve()}")
        print("\n" + "\n".join(lines))
        summary_path = self.path.with_suffix(".summary.txt")
        try:
            summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        except OSError as error:
            print(f"  요약 파일 저장 실패: {error}", file=sys.stderr)
        else:
            print(f"  읽기 쉬운 요약: {summary_path.resolve()}")


class InstagramUI:
    def __init__(self, context, account):
        self.account = account
        self.saved_url = f"{BASE}/{account}/saved/"
        self.list_page = context.new_page()
        self.post_page = context.new_page()
        self.first_unsave_verified = False

    def guard(self, page):
        parsed = urlsplit(page.url)
        if parsed.hostname != "www.instagram.com":
            raise StopCleanup("예상하지 않은 사이트로 이동했습니다.")
        if any(part in parsed.path for part in ("/accounts/login", "/challenge", "/checkpoint")):
            raise StopCleanup("로그인 또는 계정 확인이 필요합니다. 브라우저에서 직접 처리해 주세요.")
        if page.get_by_role("dialog").filter(has_text=re.compile("나중에 다시 시도|일시적으로 차단|자동화된 행동")).count():
            raise StopCleanup("계정 제한 안내가 나타나 중단합니다.")

    def wait(self, page, probe, message, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.guard(page)
            value = probe()
            if value:
                return value
            page.wait_for_timeout(250)
        raise StopCleanup(message)

    @staticmethod
    def busy(page):
        return page.locator('[role="progressbar"]:visible, [role="status"][aria-label="읽어들이는 중..."]:visible, [aria-busy="true"]:visible').count() > 0

    def open_collection(self, collection):
        page = self.list_page
        page.goto(collection.url, wait_until="domcontentloaded")
        heading = page.get_by_role("heading", name=collection.name, exact=True)
        self.wait(page, lambda: urlsplit(page.url).path == urlsplit(collection.url).path and heading.is_visible(),
                  f"컬렉션을 확인하지 못했습니다: {collection.name}")
        if page.get_by_role("main").count() != 1:
            raise StopCleanup("컬렉션 목록 영역을 특정하지 못했습니다.")

    def collections(self):
        page = self.list_page
        page.goto(self.saved_url, wait_until="domcontentloaded")
        self.wait(page, lambda: page.get_by_text("저장한 내용은 회원님만 볼 수 있습니다", exact=True).is_visible(),
                  "본인 계정의 saved 화면을 확인하지 못했습니다. 한국어 화면과 계정을 확인해 주세요.")
        if urlsplit(page.url).path.rstrip("/") != urlsplit(self.saved_url).path.rstrip("/"):
            raise StopCleanup("요청한 계정의 saved 화면이 아닙니다.")
        found = {}
        unchanged = 0
        for _ in range(200):
            self.guard(page)
            rows = page.get_by_role("main").locator("a[href]").evaluate_all(
                "els => els.map(a => ({href:a.href,name:a.innerText || a.getAttribute('aria-label') || ''}))"
            )
            before = len(found)
            for row in rows:
                item = collection_from_link(self.account, row["href"], row["name"])
                if item:
                    found[item.id] = item
            unchanged = unchanged + 1 if before == len(found) else 0
            bottom = page.evaluate("window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5")
            if bottom and unchanged >= 3 and not self.busy(page):
                return list(found.values())
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_timeout(1000)
        raise StopCleanup("컬렉션 목록 로딩이 끝나지 않아 대상을 확정하지 못했습니다.")

    def next_post(self, collection):
        self.open_collection(collection)
        page = self.list_page
        main = page.get_by_role("main")

        def ready():
            if self.busy(page):
                return None
            links = main.locator("a[href]").evaluate_all("els => els.map(a => a.href)")
            for href in links:
                try:
                    post_id(href)
                    return href
                except StopCleanup:
                    pass
            if main.get_by_role("heading", name="저장하기", exact=True).is_visible() and main.get_by_text(EMPTY_MESSAGE, exact=True).is_visible():
                return "empty"
            return None

        value = self.wait(page, ready, "게시글도 빈 상태 안내도 확인하지 못했습니다. 컬렉션 삭제를 보류합니다.")
        return None if value == "empty" else value

    def bookmark(self, url):
        page = self.post_page
        code = post_id(url)
        self.guard(page)
        if post_id(page.url) != code:
            raise StopCleanup("현재 게시글 ID가 대상과 다릅니다.")
        main = page.get_by_role("main")
        if main.count() != 1 or page.get_by_role("dialog").count():
            return None
        # shortcut: 한국어 Instagram UI 계약. 명칭이 바뀌면 클릭 대신 중단하며 선택자를 갱신한다.
        for label, state in (("삭제", "saved"), ("저장", "unsaved")):
            buttons = main.get_by_role("button", name=label, exact=True)
            count = buttons.count()
            if 0 < count <= 2 and buttons.last.is_visible():
                # 중첩 role=button인 경우에도 북마크 아이콘 하나인지 확인한다.
                if main.get_by_role("img", name=label, exact=True).count() == 1:
                    return state, buttons.last
        return None

    def open_post(self, url):
        self.post_page.goto(url, wait_until="domcontentloaded")
        return self.wait(self.post_page, lambda: self.bookmark(url), "게시글 북마크 상태를 확인하지 못했습니다.")

    def unsave(self, url):
        state, button = self.open_post(url)
        if state == "unsaved":
            return "already_unsaved"
        button.click()
        page = self.post_page

        def confirmation_or_done():
            prompt = page.get_by_role("dialog").filter(has_text=UNSAVE_PROMPT)
            if prompt.count() == 1 and prompt.is_visible():
                return "confirmation", prompt
            state = self.bookmark(url)
            if state and state[0] == "unsaved":
                return "done", None
            return None

        action, prompt = self.wait(page, confirmation_or_done, "해제 결과가 불명확합니다. 북마크를 다시 누르지 않고 중단합니다.")
        if action == "confirmation":
            button = prompt.get_by_role("button", name="삭제", exact=True)
            if button.count() != 1:
                raise StopCleanup("전체 저장 해제 버튼을 구분하지 못했습니다.")
            button.click()
            self.wait(page, lambda: self.bookmark(url) and self.bookmark(url)[0] == "unsaved",
                      "전체 저장 해제 후 상태 확인에 실패했습니다.")
        if not self.first_unsave_verified:
            # 첫 해제만 실제 새로고침으로 확인한다. UI 전환 직후의 요청 반영을 기다린다.
            page.wait_for_timeout(1000)
            page.reload(wait_until="domcontentloaded")

            def refreshed_unsaved():
                state = self.bookmark(url)
                return state and state[0] == "unsaved"

            self.wait(page, refreshed_unsaved, "첫 저장 해제 후 새로고침에서 해제 상태를 확인하지 못했습니다.")
            self.first_unsave_verified = True
            print("첫 저장 해제의 새로고침 확인 완료. 이후 게시글은 화면의 해제 상태로 확인합니다.", flush=True)
        return "unsaved"

    def delete_collection(self, collection):
        # 빈 상태는 최소 두 번의 별도 이동으로 확인한다.
        if self.next_post(collection) is not None or self.next_post(collection) is not None:
            raise StopCleanup("남은 게시글이 있어 컬렉션 삭제를 보류합니다.")
        page = self.list_page
        page.get_by_role("main").get_by_role("button", name="옵션 수정", exact=True).click()
        menu = page.get_by_role("dialog").filter(has=page.get_by_role("button", name="컬렉션 삭제", exact=True))
        self.wait(page, lambda: menu.count() == 1 and menu.is_visible(), "컬렉션 삭제 메뉴를 확인하지 못했습니다.")
        menu.get_by_role("button", name="컬렉션 삭제", exact=True).click()

        def deleted_or_confirmation():
            # 기존 메뉴는 반응 중일 수 있으므로 새 확인창과 구분한다.
            dialogs = page.get_by_role("dialog")
            for index in range(dialogs.count()):
                dialog = dialogs.nth(index)
                text = dialog.inner_text()
                if "저장된 항목에서 추가" in text or "컬렉션 수정" in text:
                    continue
                headings = dialog.get_by_role("heading").all_text_contents()
                if "컬렉션" in " ".join(headings) and "삭제" in " ".join(headings):
                    choices = dialog.get_by_role("button", name=re.compile(r"^(삭제|컬렉션 삭제)$"))
                    if choices.count() == 1:
                        return "confirm", choices
                    raise StopCleanup("컬렉션 삭제 확인 버튼이 모호합니다.")
            if urlsplit(page.url).path.rstrip("/") == urlsplit(self.saved_url).path.rstrip("/") and page.get_by_text("저장한 내용은 회원님만 볼 수 있습니다", exact=True).is_visible():
                return "check", None
            return None

        action, button = self.wait(page, deleted_or_confirmation,
                                   "알 수 없는 컬렉션 삭제 확인 화면입니다. 상태를 확인한 뒤 다시 실행해 주세요.")
        if action == "confirm":
            button.click()
            self.wait(page, lambda: page.get_by_role("dialog").count() == 0,
                      "컬렉션 삭제 확인창이 닫히지 않았습니다.")
        if any(item.id == collection.id for item in self.collections()):
            raise StopCleanup("saved 목록에 컬렉션이 남아 있어 삭제 완료로 처리하지 않습니다.")


def clean_collection(ui, collection, journal):
    """현재 서버 목록을 반복해서 읽으며 처리한다. 과거 로그로 항목을 건너뛰지 않는다."""
    attempts = Counter()
    journal.record("collection_started", collection)
    print(f"[{collection.name}] 컬렉션 정리 시작", flush=True)
    while True:
        url = ui.next_post(collection)
        if url is None:
            journal.record("empty_verified", collection)
            journal.record("collection_delete_pending", collection)
            ui.delete_collection(collection)
            journal.record("deleted_verified", collection)
            print(f"[{collection.name}] 저장 해제 및 컬렉션 삭제 완료", flush=True)
            return
        code = post_id(url)
        attempts[code] += 1
        if attempts[code] > 2:
            raise StopCleanup("같은 게시글이 계속 남아 있습니다. 컬렉션 삭제를 보류합니다.")
        journal.record("pending", collection, url)
        try:
            result = ui.unsave(url)
        except BaseException:
            journal.record("unknown", collection, url)
            raise
        message = journal.record(result, collection, url)
        print(message, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", required=True, help="본인의 Instagram 사용자 이름")
    parser.add_argument("--collection", action="append", default=[], help="대상 컬렉션 이름. 여러 번 지정 가능")
    parser.add_argument("--profile", type=Path, default=Path.home() / ".local/share/savedpoststree/chromium")
    parser.add_argument(
        "--log", type=Path,
        default=Path(__file__).resolve().parent / "development/support/logs/cleanup-events.jsonl",
        help="실행 기록 파일. 기본: 프로젝트의 development/support/logs/cleanup-events.jsonl",
    )
    args = parser.parse_args()
    if not ACCOUNT.fullmatch(args.account):
        parser.error("계정에는 사용자 이름만 입력하세요. URL이나 @는 제외합니다.")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        parser.exit(2, "Playwright가 필요합니다. README의 설치 순서를 확인해 주세요.\n")
    journal = Journal(args.log, args.account)
    args.profile.mkdir(parents=True, exist_ok=True)
    args.profile.chmod(0o700)
    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(args.profile.resolve()), headless=False, locale="ko-KR", viewport={"width": 1280, "height": 900}
            )
            try:
                ui = InstagramUI(context, args.account)
                ui.list_page.goto(BASE + "/", wait_until="domcontentloaded")
                input("열린 전용 브라우저에서 본인 계정으로 직접 로그인하고 표시 언어를 한국어로 설정한 뒤 Enter: ")
                available = ui.collections()
                print("\n컬렉션:")
                for item in available:
                    print(f"  {item.name} (ID {item.id})")
                names = args.collection or input("제거할 컬렉션 이름을 쉼표로 구분해 입력: ").split(",")
                selected = select_collections(available, names)
                print(f"\n계정: {args.account}")
                for item in selected:
                    print(f"  {item.name}: {item.url}")
                print("위 컬렉션의 모든 게시글을 전체 저장 해제합니다. 다른 컬렉션의 중복 저장도 해제됩니다.")
                print("빈 상태를 확인한 컬렉션은 마지막에 삭제합니다.")
                phrase = f"{args.account} 저장 해제 및 컬렉션 삭제"
                if input(f"실행하려면 '{phrase}'를 입력: ").strip() != phrase:
                    print("취소했습니다. 저장 상태를 변경하지 않았습니다.")
                    return 0
                journal.record("approved", collections=[c.__dict__ for c in selected])
                for collection in selected:
                    try:
                        clean_collection(ui, collection, journal)
                    except Exception as error:
                        journal.record("failed", collection, reason=str(error))
                        raise
            finally:
                context.close()
    except KeyboardInterrupt:
        journal.record("interrupted")
        print("\n중단했습니다. 재실행하면 현재 목록과 저장 상태를 다시 확인합니다.")
        journal.summary()
        return 130
    except Exception as error:
        print(f"\n중단: {error}\n미완료 상태는 {args.log.resolve()}에 기록했습니다.", file=sys.stderr)
        journal.summary()
        return 1
    journal.summary()
    return 0


if __name__ == "__main__":
    sys.exit(main())

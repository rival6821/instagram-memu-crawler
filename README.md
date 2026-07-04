# Find Menu Images from Instagram

인스타그램 포스트의 대체 텍스트(Alt Text) 필터링을 사용하여 메뉴판 이미지 및 텍스트를 추출하고 자동으로 다운로드하는 Python 도구입니다.

인스타그램의 대체 텍스트 중 자동 생성되는 `"문구: '메뉴 텍스트...'의 이미지일 수 있음."` 형태의 태그를 감지하여 메뉴가 포함된 포스트를 찾아내고, 본문의 메뉴 텍스트를 추출하여 파일로 저장할 수 있습니다.

---

## 🚀 작동 원리 (Strategy)

1. **포스트 목록 조회**: [Playwright](https://playwright.dev/)와 `playwright-extra`(stealth 플러그인)를 사용하여 비로그인 상태로 대상 계정의 프로필 페이지(`https://www.instagram.com/{username}/`)를 방문하여 최근 포스트 `shortcode` 목록을 직접 긁어옵니다.
2. **웹 페이지 로드**: 수집된 숏코드로 각 포스트 페이지(`https://www.instagram.com/p/{code}/`)에 우회 접속합니다.
3. **대체 텍스트 필터링**: 로드된 이미지 중 대체 텍스트(Alt Text)에 한국어 메뉴를 지칭하는 `'문구:'`가 들어간 이미지를 찾습니다.
4. **메인 이미지 감지**: 사이드바의 추천 이미지(작은 썸네일)를 배제하기 위해, 크기가 가로 800px 이상인 가장 큰 이미지를 추출합니다.
5. **텍스트 추출 및 저장**: 감지된 이미지의 파일명을 메뉴의 첫 줄로 다듬어 저장하며, 옵션에 따라 본문 텍스트(.txt)도 함께 생성합니다.

---

## 🛠️ 요구사항 (Requirements)

이 프로젝트를 실행하려면 **Node.js v18 이상**과 브라우저 자동화를 위한 Playwright 및 관련 종속성 패키지 설치가 필요합니다.

```bash
# npm 패키지 설치
npm install

# Playwright용 Chromium 브라우저 설치
npx playwright install chromium
```

---

## 💻 사용 방법 (Usage)

터미널에서 스크립트를 직접 실행할 수 있으며, 대상 인스타그램 계정명(username)이 필수 인자로 필요합니다.

```bash
node find_menu_images.js <인스타그램_계정명> [옵션]
```

### ⚙️ 사용 가능한 옵션

| 옵션 | 설명 | 기본값 |
| :--- | :--- | :--- |
| `--count N` | 스캔할 최근 포스트의 개수를 지정합니다. | `20` |
| `--outdir DIR` | 추출된 이미지가 저장될 디렉토리 경로를 지정합니다. | `./menu_images` |
| `--extract-text` | 이미지를 저장할 때 추출된 메뉴 텍스트도 `.txt` 파일로 함께 저장합니다. | `false` |
| `--only-new` | 이미 저장 폴더에 다운로드되어 있는 포스트 코드를 확인해 중복 스캔 및 다운로드를 방지합니다. | `false` |
| `--today-only` | 한국 표준시(KST) 기준 오늘 작성된 포스트만 필터링하여 스캔/다운로드합니다. | `false` |
| `--check-time-window` | 실행 기준 시간이 주중(월~금) 오전 10:00 ~ 12:00 (KST) 사이가 아닐 경우 실행을 즉시 스킵합니다. | `false` |
| `--webhook <url>` | 오늘(KST) 새로 다운로드한 메뉴 이미지 URL을 전송할 외부 웹훅 URL을 지정합니다. | `https://test.com/api/menu` |

### 💡 사용 예시

* **기본 실행 (최근 20개 포스트 중 메뉴 감지하여 다운로드)**:
  ```bash
  node find_menu_images.js target_store_account
  ```

* **주중 자동 스케줄러 실행 시 권장 옵션 (새로운 포스트와 오늘 작성된 메뉴만 빠르게 확인 및 시간대 검사)**:
  ```bash
  node find_menu_images.js target_store_account --today-only --only-new --check-time-window --extract-text
  ```

---

## 📁 저장 결과물 및 파일명 규칙

이미지 다운로드 시 중복 방지와 가독성을 위해 다음과 같은 파일명 규칙을 따릅니다.

### 파일명 포맷
* 메뉴 텍스트가 추출된 경우: `YYYY-MM-DD_{포스트코드}_{메뉴_텍스트_첫줄}.jpg`
* 메뉴 텍스트가 없는 경우: `YYYY-MM-DD_{포스트코드}.jpg`

### 📌 오늘의 메뉴 정적 링크 기능
크롤링 완료 후 오늘(KST) 다운로드된 이미지 중 가장 최신의 이미지와 텍스트 파일을 찾아, 고정 경로에 `today_menu.jpg` 및 `today_menu.txt`로 복사합니다.
외부 웹 서버나 봇(Slack, Telegram 등)에서 오늘의 메뉴를 제공할 때 파일명이 고정되어 있어 가져다 쓰기 편리합니다.

### 예시 디렉토리 구조
`--extract-text` 옵션을 켠 상태에서 실행할 경우 아래와 같이 `.jpg` 파일과 동일한 이름의 `.txt` 파일이 매칭되어 저장됩니다.

```text
menu_images/
├── today_menu.jpg                   # 복사된 오늘의 최신 메뉴판 이미지
├── today_menu.txt                   # 복사된 오늘의 최신 메뉴판 텍스트
├── 2026-07-01_C1a2B3c4D_아메리카노_4_500원_카페라떼_5_000원.jpg
├── 2026-07-01_C1a2B3c4D_아메리카노_4_500원_카페라떼_5_000원.txt
├── 2026-07-03_E5f6G7h8I_오늘의_파스타_16_000원.jpg
└── 2026-07-03_E5f6G7h8I_오늘의_파스타_16_000원.txt
```

`.txt` 파일 내부에는 추출된 원본 메뉴 텍스트와 함께 출처 URL 및 생성 정보가 아래 양식으로 저장됩니다.

```text
# Menu from 2026-07-03 (E5f6G7h8I)
# Source: @target_store_account
# URL: https://www.instagram.com/p/E5f6G7h8I/

오늘의 파스타 16,000원
리조또 15,000원
에이드 6,000원
```

---

## 🔗 외부 서비스 연동 (Webhook API)

오늘 날짜(KST)에 새로 다운로드된 오늘의 메뉴가 있는 경우, 해당 이미지의 CDN URL 주소와 포스트 상세 정보를 지정된 외부 서비스 API에 `POST` 요청(JSON 형식)으로 실시간 전송할 수 있습니다.

### 요청 정보
* **HTTP Method**: `POST`
* **Content-Type**: `application/json`
* **전송 Payload**:
  ```json
  {
    "imageUrl": "https://instagram.f... (이미지 원본 주소)",
    "postUrl": "https://www.instagram.com/p/...",
    "timestamp": "2026-07-04T14:00:00.000Z"
  }
  ```

### 실행 예시
```bash
node find_menu_images.js target_store_account --webhook "https://your-server.com/api/menu-webhook"
```

---

## ⚙️ Linux 서버 자동화 가이드 (주중 10시-12시, 10분 주기)

### 1. 사전 요구사항 및 배포
프로젝트 코드를 Linux 서버의 적절한 위치(예: `/home/ubuntu/find_menu_images`)에 클론 또는 복사합니다.

헤드리스 Chromium 브라우저를 구동하기 위한 Linux 시스템 종속성 패키지를 최초 1회 설치해야 합니다:
```bash
# 패키지 설치 및 의존성 다운로드
npm install
npx playwright install chromium

# Linux OS용 Playwright 시스템 의존성 패키지 설치 (sudo 권한 필요)
npx playwright install-deps
```

### 2. 래퍼 셸 스크립트 실행 권한
제공되는 `run_cron.sh` 셸 스크립트는 가상환경 자동 로드, 누락된 라이브러리 검출, 그리고 10분 주기 실행 시 중복 프로세스 실행을 방지하기 위한 파일 락(Lock) 기능을 담당합니다.
```bash
chmod +x run_cron.sh
```

---

### 3-A. Crontab 설정 (가장 간편한 방법)
서버에 크론 서비스를 이용해 주중 오전 10시부터 12시까지 10분마다 실행되도록 등록합니다.

#### 서버 시간대가 한국 표준시(KST, UTC+9)인 경우:
`crontab -e` 명령어를 입력하고 아래 내용을 추가합니다.
```cron
# 월~금요일 10:00 ~ 11:50 사이 10분마다, 그리고 12:00에 실행
*/10 10,11 * * 1-5 /home/YOUR_USER/find_menu_images/run_cron.sh target_store_account --today-only --only-new --check-time-window --extract-text >> /home/YOUR_USER/find_menu_images/cron.log 2>&1
0 12 * * 1-5 /home/YOUR_USER/find_menu_images/run_cron.sh target_store_account --today-only --only-new --check-time-window --extract-text >> /home/YOUR_USER/find_menu_images/cron.log 2>&1
```

#### 서버 시간대가 UTC(기본값)인 경우:
KST 기준 10시~12시는 **UTC 기준 01시~03시**에 해당합니다.
```cron
# KST 기준 주중 10:00 ~ 12:00 -> UTC 기준 주중 01:00 ~ 03:00
*/10 1,2 * * 1-5 /home/YOUR_USER/find_menu_images/run_cron.sh target_store_account --today-only --only-new --check-time-window --extract-text >> /home/YOUR_USER/find_menu_images/cron.log 2>&1
0 3 * * 1-5 /home/YOUR_USER/find_menu_images/run_cron.sh target_store_account --today-only --only-new --check-time-window --extract-text >> /home/YOUR_USER/find_menu_images/cron.log 2>&1
```
*(참고: `--check-time-window` 옵션이 켜져 있으므로, 12:00 KST를 살짝 넘기더라도 스크립트 내부에서 자동으로 시간대를 필터링하여 안전하게 종료합니다.)*

---

### 3-B. Systemd Timer 설정 (로그 및 유닛 관리 추천)
시스템의 크론 대신 systemd를 사용하여 로깅(journalctl)과 생명주기를 안정적으로 분리 관리할 수 있습니다.

1. `systemd/find_menu.service` 파일 내 `YOUR_USER`와 `YOUR_INSTAGRAM_TARGET_USERNAME`을 실제 값으로 수정합니다.
2. 유닛 파일들을 systemd 설정 디렉토리로 복사합니다:
   ```bash
   sudo cp systemd/find_menu.service /etc/systemd/system/
   sudo cp systemd/find_menu.timer /etc/systemd/system/
   ```
3. 데몬을 재로드하고 타이머를 시작 및 활성화합니다:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl start find_menu.timer
   sudo systemctl enable find_menu.timer
   ```
4. 타이머 작동 상태 및 다음 실행 시간 확인:
   ```bash
   systemctl list-timers --all
   ```
5. 크롤러가 남긴 로그 확인:
   ```bash
   journalctl -u find_menu.service
   ```


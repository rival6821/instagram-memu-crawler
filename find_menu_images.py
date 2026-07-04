#!/usr/bin/env python3
"""
Extract and download menu board images from Instagram using alt-text filtering.

Strategy:
  1. Use instagrapi (anonymous) to get recent media shortcodes
  2. Use Playwright + stealth to visit each post page
  3. Extract alt text from the MAIN post image only (not sidebar)
  4. Filter images where alt text contains '문구:' (Korean menu indicator)
  5. Download matching images

Requirements:
  uv pip install instagrapi requests playwright playwright-stealth
  playwright install chromium

Usage:
  python find_menu_images.py <username> [--count N] [--outdir DIR] [--extract-text]
  
  --count N        Number of posts to scan (default: 20)
  --outdir DIR     Output directory (default: ./menu_images)
  --extract-text   Also save extracted menu text as .txt file
  --only-new       Skip posts already downloaded (checks outdir)
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone, time as dt_time

# Define KST Timezone
KST = timezone(timedelta(hours=9))


import requests
from instagrapi import Client
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth


def extract_menu_text(alt_text: str) -> str:
    """Extract the menu content from Instagram alt text.
    
    Pattern: "... 문구: 'MENU TEXT HERE'의 이미지일 수 있음."
    Returns the menu text or empty string.
    """
    match = re.search(r"문구:\s*'([^']+)'", alt_text)
    if match:
        return match.group(1)
    return ""


def sanitize_filename(text: str, max_len: int = 60) -> str:
    """Create a safe filename from text."""
    safe = re.sub(r'[<>:"/\\|?*]', '_', text)
    safe = safe.strip().replace('\n', ' ').replace('  ', ' ')
    if len(safe) > max_len:
        safe = safe[:max_len]
    return safe


def download_image(url: str, filepath: str) -> bool:
    """Download an image from URL to filepath. Returns True on success."""
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                )
            },
            timeout=30,
        )
        if resp.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(resp.content)
            return True
        else:
            print(f"    HTTP {resp.status_code}")
            return False
    except Exception as e:
        print(f"    Error: {e}")
        return False


def find_menu_images(
    username: str,
    count: int = 20,
    outdir: str = "./menu_images",
    extract_text: bool = False,
    only_new: bool = False,
    today_only: bool = False,
    check_time_window: bool = False,
):
    """Main function: find and download menu images from Instagram profile."""
    
    # KST current time
    now_kst = datetime.now(KST)
    today_kst = now_kst.date()

    if check_time_window:
        is_weekday = now_kst.weekday() < 5
        now_time = now_kst.time()
        in_time_window = (dt_time(10, 0, 0) <= now_time <= dt_time(12, 1, 0))
        
        if not (is_weekday and in_time_window):
            print(f"⏰ [Skip] Current time ({now_kst.strftime('%Y-%m-%d %H:%M:%S')}) is outside weekday 10:00 - 12:00 KST.")
            return

    os.makedirs(outdir, exist_ok=True)

    
    # Track already-downloaded post codes (for --only-new)
    downloaded_codes = set()
    if only_new and os.path.isdir(outdir):
        for fname in os.listdir(outdir):
            if fname.endswith('.jpg'):
                parts = fname.split('_')
                for p in parts:
                    if len(p) >= 8 and p[0].isalpha():
                        downloaded_codes.add(p)
    
    # Step 1: Get media list via instagrapi (anonymous)
    print(f"📋 Fetching {count} recent posts from @{username}...")
    cl = Client()
    try:
        user_id = cl.user_id_from_username(username)
        medias = cl.user_medias(user_id, amount=count)
    except Exception as e:
        print(f"❌ Failed to get media list: {e}")
        return
    
    print(f"   Got {len(medias)} posts.\n")
    
    # Filter by today_only if active
    if today_only:
        filtered_medias = []
        for m in medias:
            post_dt = m.taken_at
            if post_dt.tzinfo is None:
                post_dt = post_dt.replace(tzinfo=timezone.utc)
            post_dt_kst = post_dt.astimezone(KST)
            if post_dt_kst.date() == today_kst:
                filtered_medias.append(m)
        medias = filtered_medias
        print(f"   {len(medias)} posts from today ({today_kst.strftime('%Y-%m-%d')}) found.\n")

    # Filter out already-downloaded if --only-new
    if only_new:
        medias = [m for m in medias if m.code not in downloaded_codes]
        print(f"   {len(medias)} new posts to scan (skipped {len(downloaded_codes)} already downloaded).\n")
    
    if not medias:
        print("No new/today's posts to process.")
        return

    
    # Step 2: Visit each post page with Playwright and extract alt text
    print(f"🔍 Scanning posts for menu images...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="ko-KR",
        )
        page = context.new_page()
        stealth = Stealth()
        stealth.apply_stealth_sync(page)
        
        total_downloaded = 0
        skipped_non_menu = 0
        skipped_video = 0
        
        for i, m in enumerate(medias):
            code = m.code
            
            # Skip video posts (media_type=2) — thumbnails are low quality
            if m.media_type == 2:
                date_str = m.taken_at.strftime("%m/%d") if m.taken_at else "??"
                print(f"  ⊘ [{i+1:2d}] {code} ({date_str}) — video, skipped")
                skipped_video += 1
                continue
            
            post_url = f"https://www.instagram.com/p/{code}/"
            
            try:
                page.goto(post_url, wait_until="domcontentloaded", timeout=20000)
                # Wait for any img with alt text to load
                page.wait_for_selector('img[alt]', timeout=10000)
                page.wait_for_timeout(2000)  # let alt text fully populate
            except Exception as e:
                print(f"  ⚠ [{i+1:2d}] {code} — page load issue: {e}")
                continue
            
            # Main post image is always the LARGEST image on the page (1080px+).
            # Sidebar suggestions are thumbnails (≤640px).
            # Take the largest '문구:' image — if it's big enough, it's the main post.
            alt_data = page.evaluate("""
                (() => {
                    const candidates = Array.from(document.querySelectorAll('img[alt]'))
                        .filter(img => img.alt.includes('문구:') && img.naturalWidth >= 200);
                    if (candidates.length === 0) return [];
                    
                    // Sort by area descending — main post image is always the largest
                    candidates.sort((a, b) => 
                        (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight)
                    );
                    const largest = candidates[0];
                    
                    // Main post images are ≥800px wide; sidebar thumbnails are ≤640px
                    // If the largest 문구: image is small, it's a sidebar image from another post
                    if (largest.naturalWidth < 800) return [];
                    
                    return [{alt: largest.alt, src: largest.src}];
                })()
            """)
            
            if not alt_data:
                date_str = m.taken_at.strftime("%m/%d") if m.taken_at else "??"
                print(f"  · [{i+1:2d}] {code} ({date_str}) — not a menu post")
                skipped_non_menu += 1
                continue
            
            date_str = m.taken_at.strftime("%Y-%m-%d") if m.taken_at else "unknown"
            
            for j, item in enumerate(alt_data):
                src = item["src"]
                alt = item["alt"]
                
                # Extract menu text
                menu_text = extract_menu_text(alt)
                
                # Build filename
                suffix = f"_{j+1}" if len(alt_data) > 1 else ""
                if menu_text:
                    first_line = menu_text.split('\n')[0].strip() if '\n' in menu_text else menu_text.strip()
                    label = sanitize_filename(first_line)
                    filename = f"{date_str}_{code}{suffix}_{label}.jpg"
                else:
                    filename = f"{date_str}_{code}{suffix}.jpg"
                
                filepath = os.path.join(outdir, filename)
                
                # Download the image
                success = download_image(src, filepath)
                if success:
                    size_kb = os.path.getsize(filepath) / 1024
                    print(f"  📷 [{i+1:2d}] {filename}  ({size_kb:.0f} KB)")
                    total_downloaded += 1
                    
                    # Save extracted text
                    if extract_text and menu_text:
                        txt_path = filepath.replace('.jpg', '.txt')
                        with open(txt_path, 'w', encoding='utf-8') as f:
                            f.write(f"# Menu from {date_str} ({code})\n")
                            f.write(f"# Source: @{username}\n")
                            f.write(f"# URL: {post_url}\n\n")
                            f.write(menu_text)
            
            # Small delay between pages
            time.sleep(1)
        
        browser.close()
    
    # Update 'today_menu.jpg' and 'today_menu.txt' with the latest file from today
    today_str = today_kst.strftime("%Y-%m-%d")
    today_files = []
    if os.path.isdir(outdir):
        for fname in os.listdir(outdir):
            if fname.startswith(today_str) and fname.endswith(".jpg") and not fname.startswith("today_menu"):
                fpath = os.path.join(outdir, fname)
                today_files.append((fpath, os.path.getmtime(fpath)))
    
    if today_files:
        today_files.sort(key=lambda x: x[1], reverse=True)
        latest_today_img = today_files[0][0]
        
        import shutil
        today_jpg_dest = os.path.join(outdir, "today_menu.jpg")
        try:
            shutil.copy2(latest_today_img, today_jpg_dest)
            print(f"📌 Updated today's menu image: {today_jpg_dest}")
        except Exception as e:
            print(f"❌ Failed to copy today's menu image: {e}")
            
        latest_today_txt = latest_today_img.replace(".jpg", ".txt")
        today_txt_dest = os.path.join(outdir, "today_menu.txt")
        if os.path.exists(latest_today_txt):
            try:
                shutil.copy2(latest_today_txt, today_txt_dest)
                print(f"📌 Updated today's menu text: {today_txt_dest}")
            except Exception as e:
                print(f"❌ Failed to copy today's menu text: {e}")
        else:
            if os.path.exists(today_txt_dest):
                try:
                    os.remove(today_txt_dest)
                except Exception as e:
                    pass
    else:
        print("ℹ No menu images found for today to copy as today_menu.jpg.")
    
    print(f"\n📊 Summary:")
    print(f"   Photos scanned:   {len(medias) - skipped_video}")
    print(f"   Videos skipped:   {skipped_video}")
    print(f"   Non-menu posts:   {skipped_non_menu}")
    print(f"   Images downloaded: {total_downloaded}")
    print(f"   Output directory:  {os.path.abspath(outdir)}")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Find and download Instagram menu board images via alt text filtering"
    )
    parser.add_argument("username", help="Instagram username")
    parser.add_argument("--count", type=int, default=20, help="Number of posts to scan (default: 20)")
    parser.add_argument("--outdir", default="./menu_images", help="Output directory (default: ./menu_images)")
    parser.add_argument("--extract-text", action="store_true", help="Also save extracted menu text as .txt")
    parser.add_argument("--only-new", action="store_true", help="Skip posts already downloaded (checks outdir)")
    parser.add_argument("--today-only", action="store_true", help="Only scan/download posts from today (KST)")
    parser.add_argument("--check-time-window", action="store_true", help="Only run if it's weekday 10:00 - 12:00 (KST)")
    args = parser.parse_args()
    
    find_menu_images(
        username=args.username,
        count=args.count,
        outdir=args.outdir,
        extract_text=args.extract_text,
        only_new=args.only_new,
        today_only=args.today_only,
        check_time_window=args.check_time_window,
    )


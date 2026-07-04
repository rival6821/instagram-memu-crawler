#!/usr/bin/env node
/**
 * Extract and download menu board images from Instagram using alt-text filtering.
 * 
 * Strategy:
 *   1. Use Playwright + stealth to visit the user's profile page and scrape recent post shortcodes.
 *   2. Visit each post page individually.
 *   3. Extract upload date, video type, and alt text from the images.
 *   4. Filter images where alt text contains '문구:' (Korean menu indicator) and select the largest.
 *   5. Download matching images.
 */

import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth plugin to Playwright
chromium.use(stealthPlugin());

// Define helper function to get KST Date
function getKSTDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 9));
}

function getKSTDateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractMenuText(altText) {
  const match = altText.match(/문구:\s*'([^']+)'/);
  return match ? match[1] : '';
}

function sanitizeFilename(text, maxLen = 60) {
  let safe = text.replace(/[<>:"/\\|?*]/g, '_');
  safe = safe.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
  if (safe.length > maxLen) {
    safe = safe.substring(0, maxLen);
  }
  return safe;
}

async function downloadImage(url, filepath) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      console.log(`    HTTP ${response.status}`);
      return false;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filepath, buffer);
    return true;
  } catch (err) {
    console.log(`    Error downloading image: ${err.message}`);
    return false;
  }
}

async function main() {
  program
    .argument('<username>', 'Target Instagram account username')
    .option('--count <number>', 'Number of posts to scan', (val) => parseInt(val, 10), 20)
    .option('--outdir <directory>', 'Output directory', './menu_images')
    .option('--extract-text', 'Also save extracted menu text as .txt file', false)
    .option('--only-new', 'Skip posts already downloaded (checks outdir)', false)
    .option('--today-only', 'Filter and download only posts from today (KST)', false)
    .option('--check-time-window', 'Skip execution if outside weekday 10:00 - 12:00 KST', false);

  program.parse();

  const username = program.args[0];
  const options = program.opts();

  const nowKst = getKSTDate();
  const todayStr = getKSTDateString(nowKst);

  // Time window check
  if (options.checkTimeWindow) {
    const day = nowKst.getDay(); // 0: Sunday, 1: Monday, ..., 6: Saturday
    const isWeekday = day >= 1 && day <= 5;
    const hours = nowKst.getHours();
    const minutes = nowKst.getMinutes();
    const seconds = nowKst.getSeconds();
    const timeVal = hours * 3600 + minutes * 60 + seconds;
    const startVal = 10 * 3600; // 10:00:00
    const endVal = 12 * 3600 + 1 * 60; // 12:01:00
    const inTimeWindow = timeVal >= startVal && timeVal <= endVal;

    if (!(isWeekday && inTimeWindow)) {
      const formattedTime = `${nowKst.getFullYear()}-${String(nowKst.getMonth()+1).padStart(2,'0')}-${String(nowKst.getDate()).padStart(2,'0')} ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
      console.log(`⏰ [Skip] Current time (${formattedTime}) is outside weekday 10:00 - 12:00 KST.`);
      return;
    }
  }

  await fs.mkdir(options.outdir, { recursive: true });

  // Track already-downloaded codes
  const downloadedCodes = new Set();
  if (options.onlyNew) {
    try {
      const files = await fs.readdir(options.outdir);
      for (const fname of files) {
        if (fname.endsWith('.jpg')) {
          const parts = fname.split('_');
          for (const p of parts) {
            if (p.length >= 8 && /^[A-Za-z0-9]/.test(p)) {
              downloadedCodes.add(p);
            }
          }
        }
      }
    } catch (err) {
      // Ignore if directory doesn't exist
    }
  }

  console.log(`📋 Initializing Playwright browser to fetch posts from @${username}...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  try {
    // Navigate to profile page
    console.log(`   Navigating to profile page: https://www.instagram.com/${username}/`);
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for posts to load or bypass login popup
    try {
      await page.waitForSelector('a[href*="/p/"]', { timeout: 5000 });
    } catch (err) {
      console.log('   Grid not immediately visible. Checking for login modal...');
      try {
        const closeSelectors = [
          'svg[aria-label="Close"]',
          'svg[aria-label="닫기"]',
          'div[role="dialog"] svg',
          'div[role="presentation"] svg'
        ];
        
        let clicked = false;
        for (const selector of closeSelectors) {
          const btn = await page.$(selector);
          if (btn) {
            const clickable = await btn.evaluateHandle(el => el.closest('[role="button"]') || el.closest('button') || el);
            await clickable.asElement().click();
            console.log(`   Clicked login modal close button via: ${selector}`);
            clicked = true;
            await page.waitForTimeout(1000);
            break;
          }
        }
        
        if (!clicked) {
          await page.evaluate(() => {
            const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[role="presentation"]'));
            dialogs.forEach(d => {
              if (d.textContent.includes('Sign up') || d.textContent.includes('Log in') || d.textContent.includes('가입하기')) {
                d.remove();
              }
            });
            document.body.style.overflow = 'auto';
            document.body.style.setProperty('overflow', 'auto', 'important');
          });
          console.log('   Removed login modal dialog using DOM manipulation.');
          await page.waitForTimeout(1000);
        }

        // Wait again for grid to become visible
        await page.waitForSelector('a[href*="/p/"]', { timeout: 10000 });
      } catch (bypassErr) {
        console.log(`❌ Failed to bypass login popup: ${bypassErr.message}`);
        try {
          await page.screenshot({ path: path.join(options.outdir, 'debug_screenshot.png'), fullPage: true });
          console.log(`📸 Saved debug screenshot to ${path.join(options.outdir, 'debug_screenshot.png')}`);
        } catch (screenshotErr) {
          // ignore
        }
        await browser.close();
        return;
      }
    }

    // Extract post shortcodes from links
    const postHrefs = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
      return links.map(a => a.getAttribute('href'));
    });

    const uniqueShortcodes = [...new Set(postHrefs.map(href => {
      const match = href.match(/\/p\/([^/]+)/);
      return match ? match[1] : null;
    }))].filter(Boolean);

    console.log(`   Found ${uniqueShortcodes.length} posts on profile page.`);

    let targetCodes = uniqueShortcodes;
    if (options.onlyNew) {
      targetCodes = uniqueShortcodes.filter(code => !downloadedCodes.has(code));
      console.log(`   ${targetCodes.length} new posts to scan (skipped ${downloadedCodes.size} already downloaded).`);
    }

    // Cap by count option
    targetCodes = targetCodes.slice(0, options.count);
    if (targetCodes.length === 0) {
      console.log('No new posts to process.');
      await browser.close();
      return;
    }

    console.log(`🔍 Scanning ${targetCodes.length} posts for menu images...`);

    let totalDownloaded = 0;
    let skippedNonMenu = 0;
    let skippedVideo = 0;

    for (let i = 0; i < targetCodes.length; i++) {
      const code = targetCodes[i];
      const postUrl = `https://www.instagram.com/p/${code}/`;

      try {
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('img[alt]', { timeout: 10000 });
        await page.waitForTimeout(2000); // Allow alt text and video to fully populate
      } catch (err) {
        console.log(`  ⚠ [${i + 1}/${targetCodes.length}] ${code} — page load issue: ${err.message}`);
        continue;
      }

      // Check if it's a video post
      const isVideo = await page.evaluate(() => {
        const mainArticle = document.querySelector('article');
        if (mainArticle) {
          return mainArticle.querySelector('video') !== null;
        }
        return document.querySelector('video') !== null;
      });

      if (isVideo) {
        console.log(`  ⊘ [${i + 1}/${targetCodes.length}] ${code} — video, skipped`);
        skippedVideo++;
        continue;
      }

      // Extract publication date to check against todayOnly and to name the file
      const takenAtStr = await page.evaluate(() => {
        const timeEl = document.querySelector('time[datetime]');
        return timeEl ? timeEl.getAttribute('datetime') : null;
      });

      if (!takenAtStr) {
        console.log(`  ⚠ [${i + 1}/${targetCodes.length}] ${code} — cannot find post upload date, skipped`);
        continue;
      }

      const postDate = new Date(takenAtStr);
      // Adjust to KST
      const postKST = new Date(postDate.getTime() + (9 * 3600000));
      const postDateStr = getKSTDateString(postKST);

      // Check today_only filter
      if (options.todayOnly && postDateStr !== todayStr) {
        console.log(`  · [${i + 1}/${targetCodes.length}] ${code} (${postDateStr.substring(5)}) — not from today, skipped`);
        continue;
      }

      // Extract main menu image candidates
      const altData = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('img[alt]'))
          .filter(img => img.alt.includes('문구:') && img.naturalWidth >= 200);
        if (candidates.length === 0) return [];

        // Sort by area descending — main post image is always the largest
        candidates.sort((a, b) => 
          (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight)
        );
        const largest = candidates[0];

        // Main post images are >=800px wide; sidebar thumbnails are <=640px
        if (largest.naturalWidth < 800) return [];

        return [{ alt: largest.alt, src: largest.src }];
      });

      if (altData.length === 0) {
        console.log(`  · [${i + 1}/${targetCodes.length}] ${code} (${postDateStr.substring(5)}) — not a menu post`);
        skippedNonMenu++;
        continue;
      }

      for (let j = 0; j < altData.length; j++) {
        const item = altData[j];
        const src = item.src;
        const alt = item.alt;

        const menuText = extractMenuText(alt);
        const suffix = altData.length > 1 ? `_${j + 1}` : '';
        let filename = '';

        if (menuText) {
          const firstLine = menuText.includes('\n') ? menuText.split('\n')[0].trim() : menuText.trim();
          const label = sanitizeFilename(firstLine);
          filename = `${postDateStr}_${code}${suffix}_${label}.jpg`;
        } else {
          filename = `${postDateStr}_${code}${suffix}.jpg`;
        }

        const filepath = path.join(options.outdir, filename);
        const success = await downloadImage(src, filepath);

        if (success) {
          const stat = await fs.stat(filepath);
          const sizeKb = stat.size / 1024;
          console.log(`  📷 [${i + 1}/${targetCodes.length}] ${filename} (${sizeKb.toFixed(0)} KB)`);
          totalDownloaded++;

          if (options.extractText && menuText) {
            const txtPath = filepath.replace('.jpg', '.txt');
            const txtContent = `# Menu from ${postDateStr} (${code})\n# Source: @${username}\n# URL: ${postUrl}\n\n${menuText}`;
            await fs.writeFile(txtPath, txtContent, 'utf-8');
          }
        }
      }

      // Small delay between visits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n🎉 Processed ${targetCodes.length} posts.`);
    console.log(`   Downloaded: ${totalDownloaded} | Skipped video: ${skippedVideo} | Skipped non-menu: ${skippedNonMenu}\n`);

  } catch (err) {
    console.error(`❌ Unexpected error: ${err.message}`);
  } finally {
    await browser.close();
  }

  // Update today's static link files
  const todayFiles = [];
  try {
    const files = await fs.readdir(options.outdir);
    for (const fname of files) {
      if (fname.startsWith(todayStr) && fname.endsWith('.jpg') && !fname.startsWith('today_menu')) {
        const fpath = path.join(options.outdir, fname);
        const stat = await fs.stat(fpath);
        todayFiles.push({ path: fpath, mtime: stat.mtimeMs });
      }
    }
  } catch (err) {
    // Ignore folder readdir errors
  }

  if (todayFiles.length > 0) {
    todayFiles.sort((a, b) => b.mtime - a.mtime);
    const latestTodayImg = todayFiles[0].path;
    const todayJpgDest = path.join(options.outdir, 'today_menu.jpg');

    try {
      await fs.copyFile(latestTodayImg, todayJpgDest);
      console.log(`📌 Updated today's menu image: ${todayJpgDest}`);
    } catch (err) {
      console.log(`❌ Failed to copy today's menu image: ${err.message}`);
    }

    const latestTodayTxt = latestTodayImg.replace('.jpg', '.txt');
    const todayTxtDest = path.join(options.outdir, 'today_menu.txt');
    try {
      const txtExists = await fs.access(latestTodayTxt).then(() => true).catch(() => false);
      if (txtExists) {
        await fs.copyFile(latestTodayTxt, todayTxtDest);
        console.log(`📌 Updated today's menu text: ${todayTxtDest}`);
      }
    } catch (err) {
      console.log(`❌ Failed to copy today's menu text: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

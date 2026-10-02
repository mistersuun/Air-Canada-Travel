# Phone test checklist

Run this on your iPhone after each deploy that touches passes, files, the
service worker or `netlify.toml`. It takes about 15 minutes, plus a check a
few days later (step 10). Steps 1 to 12 are for iPhone; step 13 lists what
is different on Android.

Desktop QA covers a lot of this already: Playwright WebKit (iPhone 15) and
Chromium (Pixel 7), with the real CSP and headers. Desktop can't test the
real camera, the real share sheet, Home Screen install, iOS storage
eviction, or a gate scanner. Those are the reason for this list.

Have ready: a real boarding pass (in the Air Canada app, the Wallet, a
screenshot or the PDF email), and a second phone with a barcode-scanner app
that reads PDF417 and Aztec.

## iPhone (Safari)

1. **Install to the Home Screen.** In Safari, open the site, tap Share, then
   Add to Home Screen, then open Routes from its icon.
   *Pass:* it opens full screen with no Safari bars and the right icon. Content
   isn't hidden behind the notch or Dynamic Island, and the tab bar sits above
   the home indicator.
   *Note:* the Home Screen app keeps its own storage, separate from Safari.
   Do steps 2 to 12 in the installed app, not in a Safari tab.

2. **Settings shows the files are kept.** Open Settings and find "Files on
   this phone".
   *Pass:* in the installed app it says "Kept until you delete them." In a
   normal Safari tab it says "On iPhone, add Routes to your Home Screen so
   these files are kept."

3. **Scan a real pass with the camera.** Open a trip, tap Add boarding pass,
   then Scan. Allow the camera.
   *Pass:* the rear camera shows, and the pass reads within a few seconds of
   filling the frame. "Check the details" shows your name, booking code, seat
   and the matching leg, tagged Scheduled. The camera turns off after the
   read: the green camera dot in the status bar goes away.

4. **Add a pass from a screenshot, then from a PDF.** Use Photo with a
   screenshot of the pass, then PDF with the airline's PDF (pick it in the
   Files app).
   *Pass:* both reach "Check the details" with the same fields as step 3.
   Nothing shows "Couldn't save". If a pass can't be read, you get a plain
   message and an offer to save the image as a file. The app never freezes.

5. **Pass view keeps the screen on.** Open a saved pass. Set
   Settings > Display & Brightness > Auto-Lock to 30 seconds, then leave the
   phone untouched for 1 minute.
   *Pass:* the "Screen stays on" chip shows and the screen doesn't dim or
   lock. Lock the phone, unlock it, or switch apps and come back: the chip is
   back and the screen still stays on. Close the pass, wait 1 minute: the
   screen locks normally.
   *Also OK:* in Low Power Mode, iOS may refuse. The pass then says "Keep
   the screen on yourself; this browser can't." The chip must never show
   while the screen is dimming.

6. **A gate scanner can read the pass.** In pass view, turn brightness up and
   scan the barcode with the second phone's scanner app. Do it in both light
   and dark mode.
   *Pass:* it reads, and the text starts `M1` followed by your name, as on
   your original pass. "Original image" shows your own screenshot or photo.

7. **Offline.** Open the app online and wait a minute on the home screen, so
   it can save itself for offline use. Turn on Airplane Mode, swipe the app
   away in the app switcher, and open it again from the Home Screen.
   *Pass:* home, the trip, Today, Files and pass view all open. The barcode
   draws. No "Safari can't open the page" screen and no blank page.

8. **Open files.** In Files, add a PDF and a photo, then tap each.
   *Pass:* the PDF opens in a viewer and you can get back to Routes, and the
   photo opens in the photo viewer. Nothing opens blank. Kill the app and
   reopen: both files are still there.

9. **Share sheet.** Open a trip, tap Share trip, then Image, then Share….
   *Pass:* the iOS share sheet opens with the trip card image. Save Image puts
   it in Photos, and Messages attaches it. Cancel gives no error. Check the
   Text tab too. The card or text never contains the booking code, the
   barcode or any file.

10. **Files are still there a few days later.** Leave the installed app
    unopened for 3 to 8 days, then open it with no network.
    *Pass:* every pass and file from steps 3 to 8 is still there, and passes
    open with the barcode.

11. **Private Browsing (fixed in this round).** In a Safari Private tab,
    open the site and add a pass from a screenshot.
    *Pass:* it saves and opens. Before this fix it failed with "Couldn't save
    this file. Try again." The pass is gone once the private tab closes.
    That is expected.

12. **Updates arrive.** After a later deploy, open the installed app, close
    it, and open it again.
    *Pass:* the new version shows by the second open, and saved trips, passes
    and files are all still there.

## Android (Chrome), if you have one

13. Repeat steps 3 to 9 on Android, with these differences:
    - **Install:** use Chrome's Install app (or Add to Home screen). It opens
      in its own window. Settings says "Kept until you delete them." once
      installed. In a tab it may say "Your browser may clear these if space
      runs low."
    - **Wake lock:** Chrome on Android supports it. Expect the chip and no
      dimming, as in step 5.
    - **Opening a PDF (step 8):** Chrome may download the PDF instead of
      showing it. *Pass:* it ends up in Downloads and opens from there. Note
      the file name. A random name like `c835b93e-….pdf` is worth reporting.
    - **Share (step 9):** the Android share sheet opens with the PNG card.

## Reporting

For any failure, note the step number, iOS or Android version, Safari tab or
installed app, and a screenshot. In Safari you can also connect the phone to
a Mac and use Develop > [your iPhone] to see console errors.

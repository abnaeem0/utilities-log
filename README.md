# Meter Log

A one-screen page for logging daily electricity meter readings (two meters, peak and off-peak) into a private Google Sheet.

The page itself holds no data. Readings live in your Google Sheet, and the page can only read or write them with the access key that is stored on the reception phone.

- `index.html` – the entry page (served by GitHub Pages)
- `Code.gs` – the Google Sheet backend (Google Apps Script)

## One-time setup (about 5 minutes, on a computer)

1. Go to [sheets.new](https://sheets.new) and name the sheet, e.g. "Meter Log".
2. In the sheet: **Extensions > Apps Script**. Delete whatever is in the editor, paste all of `Code.gs`, and save.
3. Choose the function **setup** in the toolbar and press **Run**. Approve the permissions when asked (it needs the sheet, a Drive folder for photos, and the weather service).
4. **Deploy > New deployment > Web app**. Set *Execute as* **Me** and *Who has access* **Anyone**. Press Deploy and copy the **Web app URL** (it ends in `/exec`).
5. Back in the sheet, open the **Settings** tab and paste that URL into the **Web app URL** row. Fill in the peak and off-peak rates from your bill while you are there.
6. Reload the sheet, then use the menu **Meter Log > Reception setup link**. Open that link once on the reception phone and add the page to the home screen.

"Anyone" in step 4 only means the phone does not need a Google login. Every request is rejected unless it carries the access key.

## Daily use

Open the page around 11pm, type the four readings and the rooms occupied tonight, press **Save**.

- Each box shows the last reading and how much it has gone up.
- A reading that is lower than last time, far above normal, or unchanged turns amber or red and asks for confirmation. It can still be saved.
- Empty readings are allowed, with a confirmation.
- **Swap** buttons fix peak/off-peak or Meter 1/Meter 2 mix-ups in one tap, and the page suggests a swap when the numbers fit the other box.
- **Show last 3 entries > Edit** reopens an earlier day. Saving again replaces it, and the old values are kept in the **Changes** tab.
- Photos (or a voice note file) upload straight away and are filed by date in a Drive folder. They can be taken first and the numbers typed later.

## The sheet

| Tab | What it holds |
| --- | --- |
| Readings | One row per day: the four readings, rooms, note, flags, photo folder link |
| Analysis | Units and energy cost per day and per occupied room, with outside temperature. Rebuilt automatically |
| Settings | Access key, rates, meter names, total rooms, flag sensitivity |
| Changes | Every correction, with old and new value |
| Weather | Daily high and low for Islamabad from Open-Meteo |
| Photos | A log of uploaded files |

Notes on the Analysis tab:

- A row covers the period from the previous reading to this one. "Per occupied room" uses the rooms recorded the night before, since those guests used most of that electricity.
- Energy cost is units × the rates in Settings. It leaves out taxes, fixed charges and fuel adjustments.
- You can correct numbers directly in the Readings tab. Analysis recalculates on edit, or use **Meter Log > Recalculate analysis**.

## Changing things later

- **Lost phone or staff change:** change the Access key in Settings, then make a new setup link.
- **Changed `Code.gs`:** paste the new file into the Apps Script editor, then Deploy > Manage deployments > edit > Version: New version. The URL stays the same. Saving alone does not update the live web app.

## Publishing changes (keep the branches in sync)

There are two branches and one copy in Google, and each has to be updated separately:

| What | Where it lives | How it goes live |
| --- | --- | --- |
| Source of truth | `main` branch | Commit here first |
| The live page | `gh-pages` branch | GitHub Pages serves this branch, not `main` |
| The sheet backend | The Apps Script project attached to the Google Sheet | Not updated by git at all |

After every change to `main`, copy it to `gh-pages`:

```
git push origin main
git push origin main:gh-pages
```

A change to `index.html` is only live after the second push. A change to `Code.gs` also needs the Apps Script step above. If the page and the script are changed together, update the script first so the page never calls something the backend does not have yet.

To drop the second branch, set Settings > Pages > Source to `main` / root in the GitHub repo and delete `gh-pages`.

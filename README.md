# Vocab flashcards

Static site in `docs/` (HTML/CSS/JS, no build step). Corpus lives in `docs/vocab.json`; study progress is kept in the browser's localStorage.

## Run locally
```
cd docs
python -m http.server 8000
```

## Add a new study guide
```
pip install pdfplumber pypinyin deep-translator
python tools/vocab_tool.py add "StudyGuides/6. new guide.pdf"
```
Reads the 重点生词 table, adds pinyin (pypinyin) and English. English comes from `data/translations.json`; terms missing there are machine-translated (Google, no key) and listed in `data/needs_review.txt` - fix them in `translations.json`, then run `python tools/vocab_tool.py build` to regenerate. Then redeploy (push).

`python tools/vocab_tool.py build` rebuilds the whole corpus from every PDF in `StudyGuides/`.

## Free hosting (GitHub Pages)
Push the repo to GitHub -> Settings -> Pages -> Deploy from branch, folder `/docs`. Open the URL on your iPhone and use Share -> Add to Home Screen.

## Notes
- Progress is per-device. Move it between phone and laptop with Settings -> Export / Import progress.
- Scheduling: new cards use learning steps (Repeat 1 min, Hard 5 min, Okay 10 min, Easy graduates at 4 days); review cards grow by an Anki-style ease factor. Keyboard: tap/Space to flip, 1-4 to rate.

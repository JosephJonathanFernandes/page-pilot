# Page Pilot — Read-Only Assistant

A Chrome extension (Manifest V3) that scans the current page's interactive elements and produces a concise, speakable summary using Google Gemini.

## Features
- Scans visible interactive elements (links, buttons, inputs, selects, tabs, etc.)
- AI summary of page purpose and available actions (Gemini)
- Text-to-speech with configurable voice, rate, and pitch
- Click any element to highlight it on the page
- Filter by type and search
- Export scan as JSON
- Recent scan history
- Local fallback summary when no API key / offline
- Settings stored locally (API key, model, style, voice)

## Install (developer mode)
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Open the extension, go to Settings, paste your Gemini API key (https://aistudio.google.com/apikey)

## Permissions
- `activeTab`: scan the active tab on demand
- `storage`: store settings and history locally
- Host access to `generativelanguage.googleapis.com` for Gemini calls
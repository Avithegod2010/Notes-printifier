/**
 * i18n.ts — bilingual UI (English + हिन्दी).
 *
 * A tiny, dependency-free dictionary + zustand store. `useT()` returns a
 * translate function bound to the current language. Language choice is
 * persisted in localStorage and restored post-hydration (SSR always renders
 * English, so there is never a hydration mismatch).
 *
 * Adding strings: add `key: ['English', 'हिन्दी']` to DICT and use t('key').
 */

import { create } from 'zustand';

export type Lang = 'en' | 'hi';

const LS_KEY = 'printifier.lang';

/** [English, हिन्दी] */
const DICT: Record<string, [string, string]> = {
  // header / nav
  'nav.how': ['How it works', 'कैसे काम करता है'],
  'nav.features': ['Features', 'खूबियाँ'],
  'nav.faq': ['FAQ', 'सवाल-जवाब'],
  'nav.start': ['Start', 'शुरू करें'],
  'nav.lang': ['हिन्दी', 'English'],

  // hero
  'hero.badge1': ['Instant, in-browser', 'ब्राउज़र में तुरंत'],
  'hero.badge2': ['No uploads · No login', 'कोई अपलोड नहीं · न लॉगिन'],
  'hero.badge3': ['Works on any device', 'हर डिवाइस पर चलता है'],
  'hero.title1': ['Make Your Lecture Notes', 'अपने लेक्चर नोट्स को'],
  'hero.title2': ['Print-Ready', 'प्रिंट-रेडी बनाएँ'],
  'hero.sub': [
    'Turn lecture notes into printable notes by reducing ink and pages — perfect for exam-time printing.',
    'लेक्चर नोट्स को कम स्याही और कम पन्नों वाले प्रिंट-योग्य नोट्स में बदलें — परीक्षा के समय के लिए एकदम सही।',
  ],
  'hero.cta': ['Process a PDF', 'PDF प्रोसेस करें'],
  'hero.example': ['See a real example', 'असली उदाहरण देखें'],
  'hero.howlink': ['or see how it works', 'या देखें यह कैसे काम करता है'],
  'hero.before': ['41 dark slides · 41 sheets', '41 गहरे स्लाइड · 41 शीट'],
  'hero.after': ['3 slides/sheet · 14 bright pages', '3 स्लाइड/शीट · 14 उजले पन्ने'],

  // how it works
  'how.title': ['How It Works', 'यह कैसे काम करता है'],
  'how.sub': ['Three steps, about a minute — no account required.', 'तीन चरण, लगभग एक मिनट — कोई अकाउंट नहीं।'],
  'how.s1.t': ['Upload your PDFs', 'अपनी PDF अपलोड करें'],
  'how.s1.d': [
    'Drop one or many lecture PDFs. Pages load instantly as previews — nothing is uploaded to a server.',
    'एक या कई लेक्चर PDF डालें। पन्ने तुरंत प्रीव्यू में दिखते हैं — कुछ भी सर्वर पर नहीं जाता।',
  ],
  'how.s2.t': ['Pick, enhance & lay out', 'चुनें, सुधारें और सजाएँ'],
  'how.s2.d': [
    'Keep only the pages you need, invert dark slides to white, then stack up to 16 slides per sheet.',
    'ज़रूरी पन्ने चुनें, गहरे स्लाइड सफ़ेद करें, फिर एक शीट पर 16 तक स्लाइड लगाएँ।',
  ],
  'how.s3.t': ['Download & print', 'डाउनलोड करें और प्रिंट करें'],
  'how.s3.d': [
    'Get a bright, compact, numbered PDF ready for your printer — with stats on paper and ink saved.',
    'उजला, कॉम्पैक्ट, नंबर-वाला PDF पाएँ, प्रिंटर के लिए तैयार — बचाए गए कागज़ और स्याही के आँकड़ों के साथ।',
  ],

  // features grid
  'feat.title': ['Everything a student needs', 'छात्र की हर ज़रूरत'],
  'feat.sub': ['Inspired by the tools you love — rebuilt for the web, completely free.', 'आपके पसंदीदा टूल्स से प्रेरित — वेब के लिए, बिल्कुल मुफ़्त।'],
  'feat.invert.t': ['Invert Colors', 'रंग उलटें'],
  'feat.invert.d': ['Dark slides become bright, printable pages.', 'गहरे स्लाइड बनें उजले, प्रिंट-योग्य पन्ने।'],
  'feat.gray.t': ['Grayscale & B&W', 'ग्रेस्केल और ब्लैक-एंड-व्हाइट'],
  'feat.gray.d': ['Strip color for maximum contrast.', 'अधिकतम कंट्रास्ट के लिए रंग हटाएँ।'],
  'feat.ink.t': ['Ink Saver', 'इंक सेवर'],
  'feat.ink.d': ['Backgrounds pushed to pure white.', 'बैकग्राउंड बनें बिल्कुल सफ़ेद।'],
  'feat.grid.t': ['N-up Grid', 'N-अप ग्रिड'],
  'feat.grid.d': ['Up to 16 slides on a single sheet.', 'एक शीट पर 16 तक स्लाइड।'],
  'feat.sep.t': ['Separation Lines', 'विभाजक रेखाएँ'],
  'feat.sep.d': ['Clean cut lines between slides.', 'स्लाइड के बीच साफ़ कट लाइनें।'],
  'feat.num.t': ['Page Numbers', 'पेज नंबर'],
  'feat.num.d': ['Numbered output for easy collating.', 'आसान क्रम के लिए नंबर वाले पन्ने।'],
  'feat.quality.t': ['Quality Control', 'क्वालिटी कंट्रोल'],
  'feat.quality.d': ['Balance file size vs. crispness.', 'फ़ाइल साइज़ बनाम चार्पनेस का संतुलन।'],
  'feat.local.t': ['100% Local', '100% लोकल'],
  'feat.local.d': ['PDFs never leave your browser.', 'PDF कभी ब्राउज़र से बाहर नहीं जाते।'],

  // steps
  'step.upload': ['Upload', 'अपलोड'],
  'step.arrange': ['Arrange', 'क्रम'],
  'step.enhance': ['Enhance', 'सुधार'],
  'step.layout': ['Layout', 'लेआउट'],
  'step.finish': ['Finish', 'पूर्ण'],
  'step.aria': ['Processing steps', 'प्रोसेसिंग चरण'],

  // upload step
  'up.aria': ['Upload PDF files', 'PDF फ़ाइलें अपलोड करें'],
  'up.drop': ['Drop your lecture PDFs here', 'अपनी लेक्चर PDF यहाँ डालें'],
  'up.multi': ['Multiple PDFs supported — pages are merged in order', 'कई PDF चलेंगी — पन्ने क्रम में जुड़ेंगे'],
  'up.select': ['Select PDF(s)', 'PDF चुनें'],
  'up.prep': ['Preparing previews…', 'प्रीव्यू बन रहे हैं…'],
  'up.privacy': ['🔒 Files never leave your device — everything runs locally in your browser', '🔒 फ़ाइलें डिवाइस पर ही रहती हैं — सब कुछ ब्राउज़र में चलता है'],
  'up.recent': ['Recent conversions', 'हाल के कन्वर्ज़न'],
  'up.recentNote': ['stored only on this device', 'सिर्फ़ इसी डिवाइस पर सेव'],
  'up.download': ['Download', 'डाउनलोड'],
  'up.remove': ['Remove', 'हटाएँ'],
  'up.rendering': ['Rendering page previews…', 'पेज प्रीव्यू बन रहे हैं…'],
  'up.files': ['files · ', 'फ़ाइलें · '],
  'up.pagesTotal': [' pages total', ' पन्ने कुल'],
  'up.sample': ['Try a sample lecture PDF', 'सैंपल लेक्चर PDF आज़माएँ'],
  'up.continue': ['Continue', 'आगे बढ़ें'],
  'up.back': ['Back', 'वापस'],
  'up.cloud': ['Import from cloud', 'क्लाउड से इंपोर्ट'],
  'up.cloudHint': ['Paste a Google Drive / Dropbox / direct PDF link', 'Google Drive / Dropbox / सीधा PDF लिंक चिपकाएँ'],
  'up.cloudUrl': ['https://drive.google.com/file/d/…', 'https://drive.google.com/file/d/…'],
  'up.cloudGo': ['Import', 'इंपोर्ट करें'],
  'up.cloudNote': ['The file is fetched once by our server and sent straight to your browser — nothing is stored.', 'फ़ाइल सर्वर से एक बार लाकर सीधे आपके ब्राउज़र को भेजी जाती है — कुछ भी सेव नहीं होता।'],
  'up.cloudBusy': ['Fetching from cloud…', 'क्लाउड से लाया जा रहा है…'],
  'up.cloudFail': ['Could not fetch that link. For Drive files, set sharing to “Anyone with the link”.', 'यह लिंक नहीं खुला। Drive फ़ाइल के लिए शेयरिंग “Anyone with the link” रखें।'],
  'up.cloudOnlyWeb': ['Cloud import needs the website (not available offline).', 'क्लाउड इंपोर्ट के लिए वेबसाइट चाहिए (ऑफ़लाइन उपलब्ध नहीं)।'],

  // pages step
  'pg.selected': ['pages selected · tap a page to include / exclude', 'पन्ने चुने गए · शामिल/हटाने के लिए पेज दबाएँ'],
  'pg.dragHint': [' · drag to reorder', ' · क्रम बदलने के लिए खींचें'],
  'pg.skipBlank': ['Skip blank pages', 'खाली पन्ने छोड़ें'],
  'pg.selectAll': ['Select all', 'सब चुनें'],
  'pg.clear': ['Clear', 'हटा दें'],
  'pg.skipped': ['Skipped {n} blank page(s)', '{n} खाली पन्ने छोड़े गए'],
  'pg.noBlank': ['No blank pages found', 'कोई खाली पन्ना नहीं मिला'],
  'pg.scanFail': ['Could not scan pages', 'पन्ने स्कैन नहीं हो सके'],
  'pg.needOne': ['Select at least one page to continue.', 'आगे बढ़ने के लिए कम से कम एक पेज चुनें।'],
  'pg.shortcuts': ['Shortcuts:', 'शॉर्टकट:'],
  'pg.scRotate': ['rotate', 'घुमाएँ'],
  'pg.scRemove': ['remove', 'हटाएँ'],
  'pg.scMove': ['move — acts on the page you tapped/clicked last', 'खिसकाएँ — जो पेज आख़िर दबाया उसी पर चलेगा'],
  'pg.moveEarlier': ['Move page earlier', 'पेज पहले ले जाएँ'],
  'pg.moveLater': ['Move page later', 'पेज बाद में ले जाएँ'],

  // enhance step
  'en.title': ['Color mode', 'रंग मोड'],
  'en.stains': ['Stain cleanup', 'दाग़ सफ़ाई'],
  'en.stains.inv': ['Recommended — clears the blue/cyan cast that dark brown & navy slide backgrounds pick up when inverted, plus inverted red key fills. Handwriting and diagrams stay.', 'सुझावित — गहरे भूरे/नीले बैकग्राउंड के उलटने पर आने वाला नीला आभास मिटा देता है, साथ ही उलटे लाल बटन-रंग भी। हस्तलेखन और चित्र सुरक्षित रहते हैं।'],
  'en.stains.light': ['Wipes out light-blue watercolor marks between slides and the cyan fills behind question numbers & answer keys, while keeping handwriting, diagrams and text. Recommended for white-background notes.', 'स्लाइड के बीच के हल्के नीले दाग़ और सवाल-नंबर/ऑप्शन के पीछे का सायन रंग मिटा देता है; हस्तलेखन, चित्र और टेक्स्ट सुरक्षित रहते हैं। सफ़ेद बैकग्राउंड वाले नोट्स के लिए बढ़िया।'],
  'en.trim': ['Trim margins', 'किनारे काटें'],
  'en.trim.d': ['Auto-crops empty borders so content fills each grid cell — bigger, more readable text on the same paper. Worth it when stacking 3+ slides per sheet.', 'खाली किनारे हटाकर हर बॉक्स को भर देता है — उसी कागज़ पर बड़ा, पढ़ने में आसान टेक्स्ट। 3+ स्लाइड प्रति शीट पर ज़रूर लगाएँ।'],
  'en.logo': ['Remove logo / watermark', 'लोगो / वॉटरमार्क हटाएँ'],
  'en.logo.d': [
    'Box the logo directly on the page — any corner (like a top-right watermark) — and it is erased from every page. Or shave the top band with the slider below.',
    'पेज पर सीधे लोगो के चारों ओर बॉक्स बनाएँ — कोई भी कोना (जैसे ऊपर-दायाँ वॉटरमार्क) — वह हर पेज से मिट जाएगा। या नीचे स्लाइडर से ऊपरी पट्टी हटाएँ।',
  ],
  'en.logo.off': ['Off', 'बंद'],
  'en.logo.aria': ['Header strip removal height', 'हेडर हटाने की ऊँचाई'],
  'en.logo.pick': ['Select area on page', 'पेज पर क्षेत्र चुनें'],
  'en.logo.pick.done': ['Done picking', 'चयन पूरा'],
  'en.logo.pick.hint': [
    'Drag a box over the logo on the ORIGINAL page (left) — it gets erased on every page at that spot. The After preview shows the result.',
    'ओरिजिनल पेज (बाएँ) पर लोगो के चारों ओर बॉक्स खींचें — हर पेज पर उसी जगह से मिट जाएगा। After प्रीव्यू में नतीजा दिखेगा।',
  ],
  'en.logo.clear': ['Clear areas', 'क्षेत्र हटाएँ'],
  'en.logo.regions': ['{n} area(s)', '{n} क्षेत्र'],
  'en.logo.region.del': ['Remove this area', 'यह क्षेत्र हटाएँ'],
  'en.logo.band': ['Or shave the top band', 'या ऊपरी पट्टी हटाएँ'],
  'en.deskew': ['Straighten pages (auto deskew)', 'पेज सीधे करें (ऑटो-डिस्क्यू)'],
  'en.deskew.d': [
    'Detects tilted scans and phone photos and rotates each page straight before the other filters run — great for photos of handwritten notes. Pairs well with Trim margins.',
    'तिरछे स्कैन और फ़ोन-फ़ोटो पहचानकर बाकी फ़िल्टर लगने से पहले हर पेज को सीधा घुमा देता है — हाथ से लिखे नोट्स की फ़ोटो के लिए ख़ास तौर पर काम का। किनारे काटें के साथ मिलाकर लगाएँ।',
  ],
  'en.deskew.badge': ['Auto-rotation applied', 'ऑटो-रोटेशन लागू'],
  'en.ink': ['Ink saver', 'इंक सेवर'],
  'en.ink.d': ['Pushes light backgrounds to pure white so your printer skips them. 40–60 works great for dark slides.', 'हल्के बैकग्राउंड को बिल्कुल सफ़ेद कर देता है ताकि प्रिंटर उन्हें छोड़ दे। गहरे स्लाइड के लिए 40–60 सबसे अच्छा।'],
  'en.pen': ['Handwriting boost', 'हस्तलेखन बूस्ट'],
  'en.pen.d': ['Darkens pen/pencil strokes while keeping paper white — light handwriting prints clearly instead of washing out.', 'कागज़ सफ़ेद रखते हुए पेन/पेंसिल की लकीरें गहरी करता है — हल्की लिखावट भी साफ़ छपेगी।'],
  'en.ocr': ['Searchable PDF (OCR)', 'सर्च-योग्य PDF (OCR)'],
  'en.ocr.d': ['Adds an invisible text layer so you can search and select text in the output. Slower — runs OCR on every page.', 'अदृश्य टेक्स्ट लेयर जोड़ता है जिससे आउटपुट में टेक्स्ट खोजा/चुना जा सके। धीमा — हर पेज पर OCR चलता है।'],
  'en.ocr.running': ['Adding searchable text (OCR)…', 'सर्च-योग्य टेक्स्ट (OCR) जोड़ा जा रहा है…'],
  'en.ocr.page': ['page {n} of {t}', '{t} में से पेज {n}'],
  'en.presets': ['Presets', 'प्रीसेट'],
  'en.presets.save': ['Save current as preset', 'वर्तमान सेटिंग सेव करें'],
  'en.presets.name': ['Preset name (e.g. PW dark slides)', 'प्रीसेट नाम (जैसे PW डार्क स्लाइड)'],
  'en.presets.saved': ['Saved!', 'सेव हो गया!'],
  'en.presets.apply': ['Apply', 'लागू करें'],
  'en.presets.none': ['No presets yet — tune Enhance & Layout, then save one.', 'अभी कोई प्रीसेट नहीं — सेटिंग ठीक करके सेव करें।'],
  'en.preview.before': ['Before', 'पहले'],
  'en.preview.after': ['After', 'बाद में'],
  'en.preview.ink': ['~{n}% ink', '~{n}% स्याही'],
  'en.preview.saves': ['This filter combo reduces ink coverage by about {n}% on this page', 'यह कॉम्बिनेशन इस पेज पर स्याही लगभग {n}% बचाता है'],
  'en.preview.note': ['Preview shows the first selected page — filters apply to every page.', 'प्रीव्यू में पहला चुना पेज है — फ़िल्टर सभी पन्नों पर लागू होंगे।'],
  'en.preview.full': ['Full preview', 'पूरा प्रीव्यू'],
  'en.preview.page': ['Page {n} of {t} (selected pages)', 'पेज {n}/{t} (चुने पन्ने)'],
  'en.recommended': ['Recommended', 'सुझावित'],
  'en.badge.new': ['New', 'नया'],

  // color modes (compact square picker)
  'en.mode.auto': ['Smart', 'स्मार्ट'],
  'en.mode.auto.h': ['Dark slides inverted, light pages kept light', 'गहरे स्लाइड उलटे, हल्के पेज वैसे ही'],
  'en.mode.invert': ['Invert', 'उलटें'],
  'en.mode.invert.h': ['Dark slides → white pages', 'गहरे स्लाइड → सफ़ेद पेज'],
  'en.mode.original': ['Original', 'मूल'],
  'en.mode.original.h': ['Keep colors, clean background stains', 'रंग रखें, बैकग्राउंड दाग़ साफ़'],
  'en.mode.grayscale': ['Grayscale', 'ग्रेस्केल'],
  'en.mode.grayscale.h': ['Remove all color', 'सारा रंग हटाएँ'],
  'en.mode.bw': ['B&W', 'काला-सफ़ेद'],
  'en.mode.bw.h': ['Maximum ink saving', 'अधिकतम स्याही बचत'],

  // advanced collapsible
  'en.adv': ['Advanced', 'उन्नत सेटिंग्स'],
  'en.adv.sub': ['Stains · Trim · Deskew · OCR · Doctor', 'दाग़ · किनारे · डिस्क्यू · OCR · डॉक्टर'],
  'en.adv.on': ['{n}/5 on', '{n}/5 चालू'],

  // preview: compare wipe · zoom · page picker · erased overlay (F1/F4/F8)
  'en.cmp.side': ['Side by side', 'साथ-साथ'],
  'en.cmp.wipe': ['Compare', 'तुलना'],
  'en.cmp.aria': ['Drag to compare before and after', 'पहले-बाद की तुलना के लिए खींचें'],
  'en.zoom.in': ['Zoom in', 'ज़ूम इन'],
  'en.zoom.out': ['Zoom out', 'ज़ूम आउट'],
  'en.zoom.fit': ['Reset zoom', 'ज़ूम रीसेट'],
  'en.zoom.pct': ['{n}×', '{n}×'],
  'en.overlay': ['Erased', 'मिटाए गए'],
  'en.overlay.aria': ['Highlight the pixels the filters erase (red)', 'जो पिक्सेल फ़िल्टर मिटाते हैं उन्हें लाल दिखाएँ'],
  'en.overlay.hint': ['Red = removed by your filters', 'लाल = फ़िल्टर ने हटाया'],
  'en.preview.pick': ['Preview page {n} of {t}', 'प्रीव्यू पेज {n}/{t}'],

  // batch queue (F3)
  'up.batch': ['Batch queue', 'बैच क़तार'],
  'up.batch.sub': ['Pick a preset per file — each file becomes its own PDF.', 'हर फ़ाइल के लिए प्रीसेट चुनें — हर फ़ाइल का अपना PDF बनेगा।'],
  'up.batch.preset': ['Preset', 'प्रीसेट'],
  'up.batch.current': ['Current settings', 'मौजूदा सेटिंग'],
  'up.batch.run': ['Process {n} files', '{n} फ़ाइलें प्रोसेस करें'],
  'up.batch.job': ['File {i} of {n}', '{n} में से फ़ाइल {i}'],
  'up.batch.page': ['page {d}/{t}', 'पेज {d}/{t}'],
  'up.batch.done': ['All {n} files ready 🎉', 'सभी {n} फ़ाइलें तैयार 🎉'],
  'up.batch.dl': ['Download', 'डाउनलोड'],
  'up.batch.dlAll': ['Download all', 'सभी डाउनलोड करें'],
  'up.batch.cancel': ['Cancel', 'रद्द करें'],
  'up.batch.failed': ['Failed', 'असफल'],
  'up.batch.pages': ['{n} pages', '{n} पेज'],
  'up.batch.saved': ['{rs} saved on this queue', 'इस क़तार में {rs} बचे'],

  // preset share links (F2)
  'pr.shareLink': ['Copy share link', 'शेयर लिंक कॉपी करें'],
  'pr.shareLink.copied': ['Share link copied — anyone with it can apply this preset', 'शेयर लिंक कॉपी हो गया — लिंक रखने वाला प्रीसेट लगा सकता है'],
  'pr.shareLink.fail': ['Could not create the share link (offline?)', 'शेयर लिंक नहीं बना (ऑफ़लाइन?)'],
  'pr.shareLink.busy': ['Creating link…', 'लिंक बन रहा है…'],
  'pr.incomingTitle': ['Shared preset', 'शेयर किया प्रीसेट'],
  'pr.incomingBody': ['“{n}” was shared with you. Apply it now? You can save it to your presets afterwards.', '“{n}” आपके साथ शेयर किया गया। अभी लगाएँ? बाद में प्रीसेट में सेव भी कर सकते हैं।'],
  'pr.incoming.apply': ['Apply preset', 'प्रीसेट लगाएँ'],
  'pr.incoming.later': ['Not now', 'अभी नहीं'],
  'pr.incoming.applied': ['Preset “{n}” applied', 'प्रीसेट “{n}” लग गया'],
  'pr.incoming.bad': ['That preset link is broken or expired', 'प्रीसेट लिंक ग़लत या समाप्त है'],

  // print cost profile (F5)
  'rs.cost.edit': ['Edit ₹ rates', '₹ रेट बदलें'],
  'rs.cost.title': ['Your print costs', 'आपकी प्रिंट लागत'],
  'rs.cost.paper': ['Paper cost per sheet (₹)', 'प्रति शीट कागज़ लागत (₹)'],
  'rs.cost.ink': ['Ink cost per full-coverage page (₹)', 'पूरी स्याही वाले पेज की लागत (₹)'],
  'rs.cost.save': ['Save rates', 'रेट सेव करें'],
  'rs.cost.reset': ['Reset to defaults', 'डिफ़ॉल्ट पर रीसेट'],
  'rs.cost.hint': ['Ask your print shop once — every ₹ number becomes exact.', 'प्रिंट शॉप से एक बार पूछ लें — हर ₹ आँकड़ा एकदम सही हो जाएगा।'],
  'rs.cost.saved': ['Print rates saved', 'प्रिंट रेट सेव हो गए'],
  'rs.assume2': ['At your rates: ₹{p}/sheet paper · ₹{i}/full-ink page', 'आपके रेट पर: ₹{p}/शीट कागज़ · ₹{i}/पूरी-स्याही पेज'],

  // WhatsApp + Telegram share (F6) — the CONVERTED PDF goes out, not a receipt
  'rs.wa': ['WhatsApp', 'WhatsApp'],
  'rs.wa.aria': ['Send the converted PDF to WhatsApp', 'बदले गए PDF को WhatsApp पर भेजें'],
  'rs.wa.shared': ['Shared!', 'शेयर हो गया!'],
  'rs.tg': ['Telegram', 'टेलीग्राम'],
  'rs.tg.aria': ['Send the converted PDF to Telegram', 'बदले गए PDF को टेलीग्राम पर भेजें'],
  'rs.share.text': [
    'Here is the print-ready PDF — made with Notes Printifier',
    'यह रहा प्रिंट-रेडी PDF — Notes Printifier से बना',
  ],
  'rs.share.fallback': [
    'PDF downloaded — attach it in the chat that just opened',
    'PDF डाउनलोड हो गया — खुली चैट में अटैच कर दें',
  ],
  'rs.share.fail': ['Could not share the PDF', 'PDF शेयर नहीं हो सका'],

  // streaks + milestones (F7)
  'im.streak.title': ['Streak & milestones', 'स्ट्रीक और मील-पत्थर'],
  'im.streak.weeks': ['{n}-week streak', '{n} सप्ताह की स्ट्रीक'],
  'im.streak.thisweek': ['{n} this week', 'इस सप्ताह {n}'],
  'im.streak.next': ['{n} sheets to {tier}', '{tier} से {n} शीट दूर'],
  'im.streak.max': ['Top tier reached — legend!', 'सबसे ऊँचा दरजा — लीजेंड!'],
  'im.streak.none': ['Convert once a week to keep the streak alive', 'स्ट्रीक बनाए रखने के लिए हर सप्ताह एक बार चलाएँ'],
  'im.tier.bronze': ['Bronze', 'कांसा'],
  'im.tier.silver': ['Silver', 'चाँदी'],
  'im.tier.gold': ['Gold', 'सोना'],
  'im.tier.platinum': ['Platinum', 'प्लैटिनम'],
  'im.tier.diamond': ['Diamond', 'हीरा'],
  'im.tier.legend': ['Legend', 'लीजेंड'],

  // layout step
  'ly.paper': ['Paper size', 'कागज़ साइज़'],
  'ly.orientation': ['Orientation', 'दिशा'],
  'ly.portrait': ['Portrait', 'पोर्ट्रेट'],
  'ly.landscape': ['Landscape', 'लैंडस्केप'],
  'ly.original': ['Original', 'मूल'],
  'ly.perPage': ['Slides per page', 'स्लाइड प्रति पेज'],
  'ly.perPageN': ['{n} per page', '{n} प्रति पेज'],
  'ly.rows': ['Rows', 'पंक्तियाँ'],
  'ly.cols': ['Columns', 'कॉलम'],
  'ly.perSheet': ['Slides per sheet', 'प्रति शीट स्लाइड'],
  'ly.slideNums': ['Slide source numbers', 'स्लाइड सोर्स नंबर'],
  'ly.slideNumsSub': ['Stamp the original page number on each slide', 'हर स्लाइड पर मूल पेज नंबर छपेगा'],
  'ly.noteLines': ['Note lines (3-up)', 'नोट लाइनें (3-अप)'],
  'ly.noteLinesSub': ['Ruled lines beside each slide for handwritten notes', 'हर स्लाइड के बगल में लिखने की रेखाएँ'],
  'ly.noteLinesHint': ['Turns on with the 3 × 1 layout', '3 × 1 लेआउट के साथ चालू होता है'],
  'ly.separators': ['Separation lines', 'विभाजक रेखाएँ'],
  'ly.separatorsSub': ['Between slides', 'स्लाइड के बीच'],
  'ly.pageNums': ['Page numbers', 'पेज नंबर'],
  'ly.pageNumsSub': ['At the bottom', 'नीचे की ओर'],
  'ly.adv': ['Advanced', 'उन्नत सेटिंग्स'],
  'ly.adv.sub': ['Budget · Slide nos. · Cover · Booklet', 'बजट · स्लाइड नं. · कवर · बुकलेट'],
  'ly.adv.on': ['{n} on', '{n} चालू'],
  'ly.booklet': ['Booklet mode', 'बुकलेट मोड'],
  'ly.bookletSub': ['2-up, re-ordered for fold-in-half booklets', 'आधे पर मोड़ने वाले बुकलेट के लिए 2-अप क्रम'],
  'ly.footer': ['Footer label', 'फ़ुटर लेबल'],
  'ly.footerOpt': ['(optional)', '(वैकल्पिक)'],
  'ly.footerPh': ['e.g. PHY · L3 · Centre of Mass', 'जैसे PHY · L3 · गुरुत्व-केंद्र'],
  'ly.footerNote': ['Printed small at the bottom-left of every sheet.', 'हर शीट के नीचे-बाएँ छोटा छपेगा।'],
  'ly.quality': ['Output quality', 'आउटपुट क्वालिटी'],
  'ly.q.low': ['Low', 'कम'],
  'ly.q.lowD': ['Smallest file · 96 DPI', 'सबसे छोटी फ़ाइल · 96 DPI'],
  'ly.q.med': ['Medium', 'मध्यम'],
  'ly.q.medD': ['Balanced · 150 DPI', 'संतुलित · 150 DPI'],
  'ly.q.high': ['High', 'उच्च'],
  'ly.q.highD': ['Crisp text · 210 DPI', 'तीखा टेक्स्ट · 210 DPI'],
  'ly.dpi.aria': ['Render resolution (DPI)', 'रेंडर रेज़ोल्यूशन (DPI)'],
  'ly.dpi.hint': [
    'Higher = sharper text but a bigger file. The presets above set this automatically — drag to override.',
    'ज़्यादा = तीखा टेक्स्ट, पर फ़ाइल बड़ी। ऊपर के प्रीसेट इसे अपने आप चुनते हैं — बदलने के लिए खींचें।',
  ],
  'ly.dpi.custom': ['Custom', 'कस्टम'],
  'ly.dpi.reset': ['Use preset', 'प्रीसेट लगाएँ'],
  'ly.dpi.value': ['{n} DPI', '{n} DPI'],
  'ly.preview': ['Layout preview', 'लेआउट प्रीव्यू'],
  'ly.liveBadge': ['LIVE', 'लाइव'],
  'ly.liveSub': ['Real filters on the first sheet', 'पहली शीट पर असली फ़िल्टर'],
  'ly.inPages': ['Input pages', 'इनपुट पन्ने'],
  'ly.outPages': ['Output pages', 'आउटपुट पन्ने'],
  'ly.paperSaved': ['Paper saved', 'कागज़ बचा'],
  'ly.suggested': ['Suggested for this PDF: {label}', 'इस PDF के लिए सुझाव: {label}'],
  'ly.estimate': ['Estimated output', 'अनुमानित आउटपुट'],
  'ly.estSize': ['≈ {size} output file', '≈ {size} फ़ाइल'],
  'ly.estInk': ['~{n}% ink saved', '~{n}% स्याही बचेगी'],
  'ly.estCost': ['saves about {rs} in paper + ink', 'कागज़ + स्याही में लगभग {rs} बचेंगे'],
  'ly.estSampling': ['estimating from {n} sample pages…', '{n} सैंपल पेजों से आँका जा रहा है…'],
  'ly.process': ['Process File', 'फ़ाइल प्रोसेस करें'],
  'ly.processing': ['Processing page {d} of {t}… keep this tab open.', 'पेज {d}/{t} प्रोसेस हो रहा है… टैब खुला रखें।'],
  'ly.processingBg': ['Processing runs in the background — the app stays responsive.', 'प्रोसेसिंग बैकग्राउंड में चल रही है — ऐप जवाबदेह रहता है।'],
  'ly.bookletNote': ['Booklet: print 2-up duplex with “flip on short edge”, then fold — the separator line is your fold guide.', 'बुकलेट: 2-अप डुप्लेक्स, “flip on short edge” चुनकर प्रिंट करें, फिर बीच से मोड़ें — विभाजक रेखा मोड़ की निशानी है।'],
  'ly.qualityNote': ['Final PDF is generated in high quality — previews above are low-res.', 'अंतिम PDF उच्च क्वालिटी में बनता है — ऊपर के प्रीव्यू छोटे साइज़ के हैं।'],

  // result step
  'rs.ready': ['Your print-ready PDF is ready! 🎉', 'आपका प्रिंट-रेडी PDF तैयार है! 🎉'],
  'rs.sub': ['Download it and hit print — your wallet and the planet thank you.', 'डाउनलोड करें और प्रिंट करें — आपकी जेब और पृथ्वी दोनों खुश।'],
  'rs.pages': ['Pages', 'पन्ने'],
  'rs.lessPaper': ['{n}% less paper', '{n}% कम कागज़'],
  'rs.samePaper': ['same paper', 'कागज़ उतना ही'],
  'rs.inkSaved': ['Est. ink saved', 'अनुमानित स्याही बची'],
  'rs.mode': ['mode: {m}', 'मोड: {m}'],
  'rs.size': ['Output size', 'आउटपुट साइज़'],
  'rs.smaller': ['{n}% smaller than source', 'स्रोत से {n}% छोटा'],
  'rs.larger': ['{n}% larger (quality boost)', 'स्रोत से {n}% बड़ा (बेहतर क्वालिटी)'],
  'rs.layout': ['Layout', 'लेआउट'],
  'rs.searchable': ['Searchable (OCR)', 'सर्च-योग्य (OCR)'],
  'rs.repainted': ['{n} pages re-typeset', '{n} पेज दोबारा टाइप किए'],
  'rs.autoInverted': ['Smart mode inverted {n} of {t} dark pages automatically', 'स्मार्ट मोड ने {t} में से {n} गहरे पन्ने अपने आप उलटे'],
  'rs.saved': ['You saved about {rs}', 'आपने लगभग {rs} बचाए'],
  'rs.savedDetail': ['{n} sheet(s) of paper + ink', '{n} शीट कागज़ + स्याही'],
  'rs.assume': ['rough estimate: ~₹1 per sheet of paper, ink by measured coverage', 'अनुमान: ~₹1 प्रति शीट कागज़, स्याही मापी गई कवरेज से'],
  'rs.download': ['Download PDF', 'PDF डाउनलोड करें'],
  'rs.open': ['Open', 'खोलें'],
  'rs.another': ['Process another file', 'दूसरी फ़ाइल प्रोसेस करें'],
  'rs.bookletTitle': ['Booklet printing:', 'बुकलेट प्रिंटिंग:'],
  'rs.bookletBody': ['in the print dialog choose landscape + duplex with “flip on short edge”. Print the whole file, stack the sheets in order, fold once in the middle (the separator line is your fold guide) — done.', 'प्रिंट डायलॉग में लैंडस्केप + डुप्लेक्स चुनें, “flip on short edge” रखें। पूरी फ़ाइल प्रिंट करें, शीटें क्रम में रखें, बीच से मोड़ें (विभाजक रेखा मोड़ की निशानी है) — बस हो गया।'],
  'rs.duplexTitle': ['No duplex printer?', 'डुप्लेक्स प्रिंटर नहीं है?'],
  'rs.duplexBody': ['Split into odd/even files: print the odd file, flip the stack, print the even file on the back.', 'अजीज/सम फ़ाइलों में बाँटें: पहले अजीज वाली छापें, ढेर पलटें, फिर सम वाली पीछे छापें।'],
  'rs.duplexBtn': ['Create odd & even files', 'अजीज/सम फ़ाइलें बनाएँ'],
  'rs.odd': ['Odd sheets ({n})', 'अजीज शीट ({n})'],
  'rs.even': ['Even sheets ({n})', 'सम शीट ({n})'],
  'rs.previewLabel': ['Output preview', 'आउटपुट प्रीव्यू'],
  'rs.iosBody': ['iOS can’t display PDFs inside the page — but your file is ready. Tap Open to view it full-screen, or Download to save it for printing.', 'iOS पेज के अंदर PDF नहीं दिखा सकता — पर आपकी फ़ाइल तैयार है। Open दबाकर पूरी स्क्रीन पर देखें या Download से सेव करें।'],
  'rs.noResult': ['No result yet — process a file first.', 'अभी कोई रिज़ल्ट नहीं — पहले फ़ाइल प्रोसेस करें।'],
  'rs.ocrNote': ['Searchable text layer added — try Ctrl+F / search in your PDF viewer.', 'सर्च-योग्य टेक्स्ट लेयर जुड़ गई — PDF व्यूअर में Ctrl+F / खोज आज़माएँ।'],

  // stats strip
  'st.files': ['Files optimized', 'फ़ाइलें ऑप्टिमाइज़'],
  'st.pagesCompacted': ['Pages compacted', 'पन्ने कॉम्पैक्ट'],
  'st.paper': ['Less paper used', 'कम कागज़ इस्तेमाल'],
  'st.money': ['Money saved', 'पैसे बचे'],
  'st.note': ['Anonymous, aggregated stats — no accounts, no tracking, no file uploads. ₹ estimate assumes ~₹1/sheet paper + ink.', 'गुमनाम, संयुक्त आँकड़े — न अकाउंट, न ट्रैकिंग, न अपलोड। ₹ अनुमान: ~₹1/शीट कागज़ + स्याही।'],

  // server-feature dialog (static builds: GitHub Pages / offline APK)
  'sf.title': ['“{f}” needs the Printifier server', '“{f}” को Printifier सर्वर चाहिए'],
  'sf.body': [
    'This feature runs on Printifier’s small server brain, which this static hosting can’t provide. The core tools — layouts, ink-saving, booklet, presets, download & share — all run 100% in your browser and work right here.',
    'यह फ़ीचर Printifier के छोटे सर्वर-ब्रेन पर चलता है, जो स्टैटिक होस्टिंग पर उपलब्ध नहीं है। बाकी सब — लेआउट, स्याही-बचत, बुकलेट, प्रीसेट, डाउनलोड और शेयर — आपके ब्राउज़र में 100% चलता है।',
  ],
  'sf.whyBtn': ['Why?', 'क्यों?'],
  'sf.whyHosting': [
    'This site is hosted on GitHub Pages: free, fast, static file hosting with no backend. AI advice, speech, and cloud sync all need a live server process, so on this mirror they are switched off at the source — not hidden, just honest.',
    'यह साइट GitHub Pages पर है: मुफ़्त, तेज़, स्टैटिक होस्टिंग — बिना बैकएंड। AI सलाह, आवाज़ और क्लाउड सिंक के लिए जीवित सर्वर चाहिए, इसलिए इस मिरर पर ये बंद रहते हैं — छिपे नहीं, ईमानदारी से।',
  ],
  'sf.whyWorks': [
    'Everything else is pure browser magic: page picker, ink-saving enhancement, OCR, N-up layouts, booklet, presets, download, WhatsApp/Telegram share — it all works here, even offline.',
    'बाकी सब शुद्ध ब्राउज़र-जादू है: पेज चयन, स्याही-बचत, OCR, N-up लेआउट, बुकलेट, प्रीसेट, डाउनलोड, WhatsApp/Telegram शेयर — सब यहीं चलता है, ऑफ़लाइन भी।',
  ],
  'sf.howToGet': [
    'Want the full experience? Run Printifier on your own machine (bun install → bun run dev), use the Android app for the core tools offline, or wait for the hosted-server release — the code is ready, see the README.',
    'पूरा अनुभव चाहिए? Printifier अपने कंप्यूटर पर चलाएँ (bun install → bun run dev), Android ऐप से कोर-टूल्स ऑफ़लाइन इस्तेमाल करें, या होस्टेड-सर्वर रिलीज़ का इंतज़ार करें — कोड तैयार है, README देखें।',
  ],
  'sf.ok': ['Got it', 'समझ गया'],
  'sf.feature.stats': ['Community stats', 'कम्युनिटी आँकड़े'],
  'sf.feature.preset': ['Shared preset link', 'शेयर्ड प्रीसेट लिंक'],

  // faq
  'faq.title': ['FAQ', 'सवाल-जवाब'],
  'faq.sub': ['Everything you might wonder before hitting print.', 'प्रिंट दबाने से पहले जो कुछ भी जिज्ञासा हो सकती है।'],
  'faq1.q': ['Are my files uploaded to a server?', 'क्या मेरी फ़ाइलें सर्वर पर जाती हैं?'],
  'faq1.a': ['No. Everything — parsing, filters and PDF generation — runs locally in your browser. Your notes never leave your device, and it works even if you go offline after loading the page.', 'नहीं। सब कुछ — पार्सिंग, फ़िल्टर और PDF बनाना — आपके ब्राउज़र में ही चलता है। नोट्स डिवाइस से बाहर नहीं जाते, और पेज लोड होने के बाद ऑफ़लाइन भी चलता है।'],
  'faq2.q': ['How much paper and ink can I actually save?', 'कितना कागज़ और स्याही बचेगी?'],
  'faq2.a': ['Typical dark-background lecture slides shrink by 60–85% ink with Invert + Ink Saver, and stacking 3–4 slides per sheet cuts paper by 60–75%. Your exact numbers are shown after processing.', 'गहरे बैकग्राउंड वाले स्लाइड में Invert + Ink Saver से 60–85% स्याही बचती है, और एक शीट पर 3–4 स्लाइड लगाने से कागज़ 60–75% कम लगता है। सटीक आँकड़े प्रोसेसिंग के बाद दिखते हैं।'],
  'faq3.q': ['Which PDFs work best?', 'कौन-सी PDF सबसे अच्छी चलती है?'],
  'faq3.a': ['Dark-themed lecture decks (Physics Wallah style), scanned notes and text-heavy presentations. For clean white handouts, try Grayscale or B&W with a 30–50% Ink Saver instead of Invert.', 'गहरे रंग वाले लेक्चर डेक (Physics Wallah स्टाइल), स्कैन किए नोट्स और टेक्स्ट-प्रधान प्रेज़ेंटेशन। सफ़ेद हैंडआउट के लिए Invert की जगह Grayscale/B&W + 30–50% Ink Saver आज़माएँ।'],
  'faq4.q': ['Does it work on any device?', 'सभी डिवाइस पर चलता है?'],
  'faq4.a': ['Yes — phone, tablet, laptop or desktop. The whole tool runs in any modern browser (Chrome, Safari, Edge, Firefox) with nothing to install. Big files take a little longer on older phones, so keep the tab open while it processes.', 'हाँ — फ़ोन, टैबलेट, लैपटॉप या डेस्कटॉप। पूरा टूल किसी भी आधुनिक ब्राउज़र (Chrome, Safari, Edge, Firefox) में चलता है, कुछ इंस्टॉल नहीं करना। पुराने फ़ोन पर बड़ी फ़ाइल को थोड़ा समय लगता है, टैब खुला रखें।'],
  'faq5.q': ['Why does the inline preview look blank on my iPhone?', 'iPhone पर प्रीव्यू खाली क्यों दिखता है?'],
  'faq5.a': ['iOS Safari cannot display PDFs inside the page. Tap “Open” to view the PDF in a full tab, or just tap “Download” — the file itself is complete and prints perfectly.', 'iOS Safari पेज के अंदर PDF नहीं दिखा सकता। “Open” दबाकर पूरे टैब में खोलें या सीधे “Download” करें — फ़ाइल पूरी है और बढ़िया छपेगी।'],
  'faq6.q': ['Is the output PDF searchable or re-editable?', 'क्या आउटपुट PDF सर्च/एडिट हो सकता है?'],
  'faq6.a': ['By default it is a high-quality image-based PDF (that is what makes the ink savings possible) — but turn on “Searchable PDF (OCR)” in Enhance and an invisible text layer is added, so search, select and copy all work. Page numbers and separators are always real vector elements.', 'डिफ़ॉल्ट रूप से यह उच्च-क्वालिटी इमेज PDF है (इसी से स्याही बचती है) — पर Enhance में “Searchable PDF (OCR)” चालू करें तो अदृश्य टेक्स्ट लेयर जुड़ जाती है, जिससे खोज, चयन और कॉपी सब चलता है। पेज नंबर और विभाजक हमेशा असली वेक्टर होते हैं।'],
  'faq7.q': ['Is there an Android app?', 'क्या Android ऐप है?'],
  'faq7.a': ['Yes! Download the APK from the footer — the Stable build is frozen and beginner-safe, while the Beta build gets new features first. Both work fully offline and PDFs you download are saved straight to your phone.', 'हाँ! फ़ुटर से APK डाउनलोड करें — Stable बिल्ड जमा हुआ और बिगिनर-सेफ है, जबकि Beta बिल्ड में नए फ़ीचर पहले आते हैं। दोनों पूरी तरह ऑफ़लाइन चलते हैं और डाउनलोड की PDF सीधे फ़ोन में सेव होती है।'],
  'faq8.q': ['Can I import a PDF from Google Drive or Dropbox?', 'क्या Google Drive या Dropbox से PDF ला सकते हैं?'],
  'faq8.a': ['Yes — tap “Import from cloud” on the upload screen and paste the share link (set the file to “Anyone with the link”). The server fetches it once and streams it straight to your browser; nothing is stored.', 'हाँ — अपलोड स्क्रीन पर “Import from cloud” दबाकर शेयर लिंक चिपकाएँ (फ़ाइल “Anyone with the link” रखें)। सर्वर उसे एक बार लाकर सीधे आपके ब्राउज़र को भेजता है; कुछ सेव नहीं होता।'],

  // labs
  'labs.title': ['Labs', 'लैब्स'],
  'labs.badge': ['experimental', 'प्रयोगात्मक'],
  'labs.body': ['Fresh features that are still cooking. They only affect this device and you can switch them off anytime — the core tool stays untouched.', 'नए फ़ीचर जो अभी पक रहे हैं। ये सिर्फ़ इसी डिवाइस पर लागू होते हैं और कभी भी बंद किए जा सकते हैं — मुख्य टूल बेपरवाह रहता है।'],
  'labs.remember': ['Remember my settings', 'मेरी सेटिंग्स याद रखें'],

  // chrome / a11y
  'skip': ['Skip to content', 'सीधे कॉन्टेंट पर जाएँ'],
  'menu.open': ['Open menu', 'मेनू खोलें'],
  'menu.title': ['Menu', 'मेनू'],
  'up.top': ['Back to top', 'ऊपर जाएँ'],

  // hero trust row
  'trust.free': ['Free forever', 'हमेशा मुफ़्त'],
  'trust.private': ['100% private', '100% प्राइवेट'],
  'trust.offline': ['Works offline', 'ऑफ़लाइन भी चले'],

  // nav (added)
  'nav.calc': ['Calculator', 'कैलकुलेटर'],
  'how.eyebrow': ['3 simple steps', '3 आसान चरण'],
  'feat.eyebrow': ['Features', 'खूबियाँ'],
  'faq.eyebrow': ['Questions & answers', 'सवाल और जवाब'],

  // savings calculator
  'calc.eyebrow': ['Savings calculator', 'बचत कैलकुलेटर'],
  'calc.title': ['How much could YOU save?', 'आप कितनी बचत कर सकते हैं?'],
  'calc.sub': ['Drag the sliders to match your printing habits — see your year in paper and rupees.', 'स्लाइडर घुमाकर अपनी प्रिंटिंग आदतें बताएँ — एक साल का कागज़ और पैसा देखें।'],
  'calc.pages': ['Lecture pages you print each week', 'हर हफ़्ते छपने वाले लेक्चर पेज'],
  'calc.pagesUnit': ['pages / week', 'पेज / हफ़्ता'],
  'calc.style': ['How you print today', 'अभी आप कैसे छापते हैं'],
  'calc.styleDark': ['Dark slides — 1 per sheet, full ink', 'गहरे स्लाइड — 1 प्रति शीट, पूरी स्याही'],
  'calc.styleTwo': ['2 slides per sheet, plain print', '2 स्लाइड प्रति शीट, साधारण प्रिंट'],
  'calc.styleGray': ['2 slides per sheet, grayscale', '2 स्लाइड प्रति शीट, ग्रेस्केल'],
  'calc.with': ['With Notes Printifier', 'Notes Printifier के साथ'],
  'calc.withDesc': ['3 slides/sheet · ink-saver · smart invert', '3 स्लाइड/शीट · इंक-सेवर · स्मार्ट इन्वर्ट'],
  'calc.sheetsSaved': ['sheets saved a year', 'शीट बचती हैं हर साल'],
  'calc.rupeesSaved': ['rupees saved a year', 'रुपये बचते हैं हर साल'],
  'calc.today': ['Today', 'अभी'],
  'calc.printifier': ['Printifier', 'Printifier'],
  'calc.sheetsYear': ['sheets / year', 'शीट / साल'],
  'calc.note': ['Estimate assumes ~₹1 per sheet of paper and ~₹1.3 per full-ink page. Actual savings depend on your printer and slides.', 'अनुमान: ~₹1 प्रति शीट कागज़ और ~₹1.3 प्रति पूरी-स्याही पेज। असली बचत आपके प्रिंटर और स्लाइड्स पर निर्भर है।'],
  'calc.match': ['Same notes, ⅓ the sheets', 'वही नोट्स, ⅓ शीट'],

  // use cases
  'uc.eyebrow': ['Who it’s for', 'किसके लिए है'],
  'uc.title': ['Built for every study style', 'हर पढ़ाई के अंदाज़ के लिए'],
  'uc.sub': ['From last-minute exam prep to entire semesters of class notes.', 'रातों-रात परीक्षा की तैयारी से लेकर पूरे सेमेस्टर के नोट्स तक।'],
  'uc.exam.t': ['Exam crunch', 'परीक्षा की जल्दी'],
  'uc.exam.d': ['A 100-slide deck becomes a 12-sheet booklet you can revise on the bus.', '100 स्लाइड का डेक बनेगा 12 शीट की बुकलेट, बस में दोहराने लायक।'],
  'uc.class.t': ['Daily class notes', 'रोज़ के क्लास नोट्स'],
  'uc.class.d': ['Merge every subject’s PDFs, keep just the pages that matter, print once a week.', 'हर विषय की PDF मिलाएँ, ज़रूरी पन्ने चुनें, हफ़्ते में एक बार छापें।'],
  'uc.coach.t': ['Coaching & teaching', 'कोचिंग और पढ़ाना'],
  'uc.coach.d': ['Hand out bright, compact handouts instead of dark, ink-draining photocopies.', 'गहरी, स्याही-पीने वाली छाया-प्रति की जगह उजली, कॉम्पैक्ट हैंडआउट बाँटें।'],

  // footer (added)
  'ft.tagline': ['The free, private way to turn lecture PDFs into printer-friendly notes.', 'लेक्चर PDF को प्रिंटर-फ्रेंडली नोट्स में बदलने का मुफ़्त, प्राइवेट तरीका।'],
  'ft.links': ['Explore', 'जानें'],
  'ft.get': ['Get the app', 'ऐप पाएँ'],
  'ft.webapp': ['Or just use it in your browser — nothing to install.', 'या ब्राउज़र में ही चलाएँ — कुछ इंस्टॉल नहीं करना।'],
  'ft.made': ['Made for students who print smart.', 'उन छात्रों के लिए, जो समझदारी से छापते हैं।'],

  // duplex pad
  'ly.duplexPad': ['Duplex pad', 'डुप्लेक्स पैड'],
  'ly.duplexPadSub': [
    'Adds one blank page when the count is odd, so double-sided backs line up.',
    'पेज संख्या विषम होने पर एक खाली पेज जोड़ता है, जिससे डबल-साइड छपाई में पीछे के पन्ने सही बैठते हैं।',
  ],

  // preset sharing
  'en.presets.share': ['Share', 'शेयर'],
  'en.presets.shareNote': ['Share your presets with classmates', 'अपने प्रीसेट दोस्तों के साथ बाँटें'],
  'en.presets.import': ['Import', 'इम्पोर्ट'],
  'en.presets.imported': ['Imported {n} preset{s}', '{n} प्रीसेट इम्पोर्ट हुए'],
  'en.presets.importFail': ['That file is not a valid preset export.', 'यह फ़ाइल सही प्रीसेट एक्सपोर्ट नहीं है।'],

  // savings history
  'rs.histTitle': ['Your savings so far', 'आपकी अब तक की बचत'],
  'rs.histNote': ['Last {n} job{s} on this device', 'इस डिवाइस की आख़िरी {n} जॉब'],
  'rs.histEmpty': ['Process a file — your history will appear here.', 'फ़ाइल प्रोसेस करें — आपका इतिहास यहाँ दिखेगा।'],

  // folder (batch) import
  'up.folder': ['Folder', 'फ़ोल्डर'],
  'up.folderAria': ['Import a whole folder of PDFs', 'PDF का पूरा फ़ोल्डर इम्पोर्ट करें'],
  'up.folderSub': ['Teacher mode: pick a folder — every PDF inside is added.', 'टीचर मोड: फ़ोल्डर चुनें — उसकी सारी PDF जुड़ जाएँगी।'],

  // theme
  'th.toggle': ['Light / dark theme', 'लाइट / डार्क थीम'],
  'th.pick': ['Theme', 'थीम'],
  'th.pickSub': ['Pick a look — saved on this device.', 'रूप चुनें — इस डिवाइस पर सेव रहेगा।'],
  'th.violet': ['Midnight Violet', 'मिडनाइट वायलेट'],
  'th.paper': ['Paper Light', 'पेपर लाइट'],
  'th.cyber': ['Cyber Neon', 'साइबर नियॉन'],
  'th.matrix': ['Emerald Terminal', 'एमराल्ड टर्मिनल'],
  'th.ember': ['Solar Ember', 'सोलर एम्बर'],
  'th.rose': ['Rose Quartz', 'रोज़ क्वार्ट्ज़'],
  'pat.pick': ['Backdrop pattern', 'बैकड्रॉप पैटर्न'],
  'pat.grid': ['Grid', 'ग्रिड'],
  'pat.dots': ['Dots', 'डॉट्स'],
  'pat.hex': ['Hex', 'हेक्स'],
  'pat.weave': ['Weave', 'वीव'],
  'pat.none': ['Plain', 'सादा'],

  // feature grid additions
  'feat.booklet.t': ['Booklet Mode', 'बुकलेट मोड'],
  'feat.booklet.d': ['Fold-in-half booklet order for duplex printing.', 'डुप्लेक्स प्रिंटिंग के लिए बीच-से-मोड़ बुकलेट क्रम।'],
  'feat.wm.t': ['Name Stamp', 'नाम स्टैम्प'],
  'feat.wm.d': ['Print your name or roll number on every sheet.', 'हर शीट पर अपना नाम या रोल नंबर छापें।'],
  'labs.rememberD': ['Keeps your Enhance & Layout choices on this device for your next visit.', 'आपकी Enhance और Layout पसंद इसी डिवाइस पर अगली बार के लिए सेव रहती हैं।'],
  'labs.repaint': ['Text repaint (OCR)', 'टेक्स्ट री-पेंट (OCR)'],
  'labs.repaintD': [
    'Experimental: OCRs each page and re-typesets recognized text as crisp black-on-white instead of a re-compressed scan. Sharp output, tiny files; handwriting and complex diagrams automatically fall back to the original image.',
    'प्रयोगात्मक: हर पेज का OCR करके पहचाने गए टेक्स्ट को दोबारा टाइप करता है — धुंधले स्कैन की जगह साफ़ काला टेक्स्ट-ऑन-सफ़ेद। शार्प आउटपुट, छोटी फ़ाइलें; हस्तलेखन और जटिल डायग्राम अपने आप मूल इमेज पर लौट आते हैं।',
  ],
  'labs.more': ['More experiments coming: smart per-page invert, saved presets, handwriting boost…', 'और प्रयोग आ रहे हैं: स्मार्ट प्रति-पेज इनवर्ट, सेव्ड प्रीसेट, हैंडराइटिंग बूस्ट…'],

  // footer
  'ft.copyright': ['© {y} Notes Printifier — built for students, by students.', '© {y} Notes Printifier — छात्रों के लिए, छात्रों द्वारा।'],
  'ft.stable': ['Android app — Stable v1.0', 'Android ऐप — Stable v1.0'],
  'ft.beta': ['Beta — new features first', 'Beta — नए फ़ीचर पहले'],
  'ft.local': ['All processing happens locally in your browser', 'सारी प्रोसेसिंग आपके ब्राउज़र में ही होती है'],

  // update banner
  'upd.title': ['Update available — v{v}', 'अपडेट उपलब्ध — v{v}'],
  'upd.body': ['A newer version of Notes Printifier is ready. Refresh to get it.', 'Notes Printifier का नया वर्शन तैयार है। लेने के लिए रिफ़्रेश करें।'],
  'upd.reload': ['Refresh now', 'अभी रिफ़्रेश करें'],
  'upd.later': ['Later', 'बाद में'],

  // ── v1.4.0 feature batch ──────────────────────────────────────────────
  // lifetime impact meter (upload + result steps)
  'up.impactTitle': ['Your impact so far', 'आपका अब तक का असर'],
  'up.impactJobs': ['{n} conversions', '{n} कन्वर्ज़न'],
  'up.impactSheets': ['{n} sheets saved', '{n} शीट बचाईं'],
  'up.impactRupees': ['{rs} saved', '{rs} बचाए'],
  'up.impactTrees': ['≈ {n} trees', '≈ {n} पेड़'],
  'up.reprint': ['Re-printify', 'दोबारा प्रिंटिफ़ाई'],
  'up.reprintHint': ['Re-run the original files with different settings', 'मूल फ़ाइलों को दूसरी सेटिंग्स से दोबारा चलाएँ'],
  'rs.impactTitle': ['Your impact so far', 'आपका अब तक का असर'],
  'rs.impactReset': ['Reset counter', 'काउंटर रीसेट करें'],
  'rs.impactJobs': ['conversions', 'कन्वर्ज़न'],
  'rs.impactSheets': ['sheets saved', 'शीट बची'],
  'rs.impactMoney': ['saved', 'बचत'],
  'rs.impactTrees': ['trees', 'पेड़'],
  'rs.impactCo2': ['CO₂ saved', 'CO₂ बची'],
  'rs.impactNote': [
    'Counts every conversion on this device. One tree ≈ 8,333 sheets · one sheet ≈ 5 g CO₂ — friendly estimates, stored only on your phone.',
    'इस डिवाइस के हर कन्वर्ज़न की गिनती। एक पेड़ ≈ 8,333 शीट · एक शीट ≈ 5 ग्राम CO₂ — अनुमानित, सिर्फ़ आपके डिवाइस पर सेव।',
  ],
  // built-in presets
  'en.presets.builtinNote': ['Start with a built-in recipe, then fine-tune below.', 'पहले कोई बिल्ट-इन रेसिपी चुनें, फिर नीचे से अपने हिसाब से सेट करें।'],
  'pr.builtin.economy': ['Economy', 'इकोनॉमी'],
  'pr.builtin.economyD': ['Maximum savings — black & white, 6 slides per sheet, trimmed margins, draft quality.', 'अधिकतम बचत — ब्लैक एंड व्हाइट, 6 स्लाइड प्रति शीट, कटे किनारे, ड्राफ़्ट क्वालिटी।'],
  'pr.builtin.balanced': ['Balanced', 'बैलेंस्ड'],
  'pr.builtin.balancedD': ['The everyday default — smart color mode, 4 slides per sheet, medium quality.', 'रोज़मर्रा का डिफ़ॉल्ट — स्मार्ट रंग मोड, 4 स्लाइड प्रति शीट, मध्यम क्वालिटी।'],
  'pr.builtin.exam': ['Exam cram', 'परीक्षा मोड'],
  'pr.builtin.examD': ['Readability first — original colors, handwriting boost, 2 slides per sheet, high quality.', 'पढ़ाई में आसानी पहले — असली रंग, हस्तलेखन बूस्ट, 2 स्लाइड प्रति शीट, हाई क्वालिटी।'],
  // print budget auto-fit
  'ly.budget.title': ['Print budget', 'प्रिंट बजट'],
  'ly.budget.sub': ['Xerox shop charges per sheet? Set a sheet limit and we pick the tightest layout that fits.', 'ज़ेरॉक्स शॉप हर शीट के पैसे लेता है? शीट लिमिट डालें — सबसे भीड़ लेआउट जो फ़िट हो, हम चुन लेंगे।'],
  'ly.budget.ph': ['e.g. 25', 'जैसे 25'],
  'ly.budget.go': ['Auto-fit', 'ऑटो-फ़िट'],
  'ly.budget.fit': ['Fits: {n} sheets at {per} slides per sheet ✓', 'फ़िट: {per} स्लाइड प्रति शीट पर {n} शीट ✓'],
  'ly.budget.none': ['Even the tightest layout needs {n} sheets (over {limit}) — applied 8-up anyway.', 'सबसे भीड़ लेआउट को भी {n} शीट चाहिए ({limit} से ज़्यादा) — फिर भी 8-अप लगा दिया।'],

  // batch cover sheet
  'ly.cover': ['Cover page', 'कवर पेज'],
  'ly.coverSub': ['Title page listing every merged file', 'हर जुड़ी फ़ाइल की सूची वाला शीर्षक पेज'],
  'ly.cover.contents': ['Contents', 'सूची'],
  'ly.cover.pages': ['{n} pages', '{n} पन्ने'],
  'ly.cover.footnote': ['Merged print-ready PDF · notesprintifier', 'मर्ज किया प्रिंट-रेडी PDF · notesprintifier'],

  // file-size target
  'ly.sizeTarget': ['Target file size', 'फ़ाइल साइज़ लक्ष्य'],
  'ly.sizeTargetOn': ['Under {n} MB', '{n} MB से नीचे'],
  'ly.sizeTargetOff': ['Off', 'बंद'],
  'ly.sizeTargetPh': ['e.g. 5', 'जैसे 5'],
  'ly.sizeTargetHint': [
    'Quality is lowered automatically until the PDF fits — for email limits and print-shop uploads.',
    'PDF फ़िट होने तक क्वालिटी अपने आप घटेगी — ईमेल लिमिट और प्रिंट-शॉप अपलोड के लिए।',
  ],
  'ly.sizeTargetOver': ['Estimated above target — quality will be reduced while processing.', 'अनुमान लक्ष्य से ज़्यादा है — प्रोसेसिंग के समय क्वालिटी घटेगी।'],

  // receipt card
  'rs.receipt.btn': ['Save receipt card', 'रसीद कार्ड सेव करें'],
  'rs.receipt.sub': ['Ink-saving print receipt', 'स्याही-बचत प्रिंट रसीद'],
  'rs.receipt.pagesIn': ['Slides in → sheets out', 'स्लाइड इन → शीट आउट'],
  'rs.receipt.money': ['Money saved', 'पैसे बचे'],
  'rs.receipt.footnote': ['Made with Notes Printifier — free, private, in-browser', 'Notes Printifier से बना — मुफ़्त, प्राइवेट, ब्राउज़र में'],
  'rs.receipt.shared': ['Receipt shared', 'रसीद शेयर हो गई'],
  'rs.receipt.saved': ['Receipt saved as PNG', 'रसीद PNG सेव हो गई'],
  'rs.receipt.fail': ['Could not build the receipt card', 'रसीद कार्ड नहीं बना'],

  // PWA install
  'nav.install': ['Install app', 'ऐप इंस्टॉल करें'],
  // size-target result badges
  'rs.sizeTargetFit': ['Compressed in {p} extra pass(es) to fit under {n} MB', '{p} अतिरिक्त पास में {n} MB से नीचे फ़िट किया'],
  'rs.sizeTargetAlready': ['Already under the {n} MB target — no extra compression needed', 'पहले से {n} MB लक्ष्य के नीचे — कोई अतिरिक्त कंप्रेशन नहीं'],

  // ── roadmap batch: themes, patterns, palette, AI, impact ─────────────
  // new themes
  'th.crimson': ['Crimson Dusk', 'क्रिमसन डस्क'],
  'th.ocean': ['Deep Ocean', 'गहरा महासागर'],
  'th.nord': ['Nordic Frost', 'नॉर्डिक फ्रॉस्ट'],
  'th.noir': ['Noir Mono', 'नोअर मोनो'],
  'th.sand': ['Desert Sand', 'रेगिस्तानी रेत'],
  'th.mint': ['Fresh Mint', 'ताज़ा पुदीना'],
  // new backdrop patterns
  'pat.topo': ['Topographic', 'टोपोग्राफ़ी'],
  'pat.circuit': ['Circuit', 'सर्किट'],
  'pat.waves': ['Waves', 'लहरें'],
  'pat.diag': ['Diagonal', 'तिरछी रेखाएँ'],
  'pat.plus': ['Plus marks', 'प्लस निशान'],

  // ⌘K command palette
  'cp.open': ['Command menu', 'कमांड मेनू'],
  'cp.ph': ['Type a command or search…', 'कमांड लिखें या खोजें…'],
  'cp.none': ['No matching commands', 'कोई कमांड नहीं मिला'],
  'cp.actions': ['Actions', 'एक्शन'],
  'cp.navigate': ['Go to', 'यहाँ जाएँ'],
  'cp.themes': ['Themes', 'थीम'],
  'cp.patterns': ['Patterns', 'पैटर्न'],
  'cp.presets': ['Presets', 'प्रीसेट'],
  'cp.settings': ['Settings', 'सेटिंग्स'],
  'cp.process': ['Process now', 'अभी प्रोसेस करें'],
  'cp.processHint': ['Compose the selected pages into a print-ready PDF', 'चुने पन्नों से प्रिंट-रेडी PDF बनाएँ'],
  'cp.upload': ['Upload new PDFs', 'नई PDF अपलोड करें'],
  'cp.reset': ['Reset everything', 'सब रीसेट करें'],
  'cp.top': ['Back to top', 'सबसे ऊपर'],
  'cp.lang': ['Switch to हिन्दी', 'Switch to English'],
  'cp.flip': ['Light / dark flip', 'लाइट / डार्क बदलें'],
  'cp.doctor': ['Ask the Print Doctor', 'प्रिंट डॉक्टर से पूछें'],
  'cp.impact': ['View your impact', 'अपना असर देखें'],
  'cp.shortcuts': ['Keyboard shortcuts', 'कीबोर्ड शॉर्टकट'],
  'cp.resetDone': ['Everything reset', 'सब रीसेट हो गया'],
  'cp.presetApplied': ['Preset “{n}” applied', 'प्रीसेट “{n}” लगाया गया'],

  // AI print doctor
  'dr.title': ['Print Doctor', 'प्रिंट डॉक्टर'],
  'dr.sub': ['AI reads your document and settings, then suggests the sweet spot.', 'AI आपका डॉक्युमेंट और सेटिंग्स देखकर सबसे सही सेटिंग बताता है।'],
  'dr.ask': ['Ask the Doctor', 'डॉक्टर से पूछें'],
  'dr.again': ['Ask again', 'फिर पूछें'],
  'dr.thinking': ['Doctor is thinking…', 'डॉक्टर सोच रहा है…'],
  'dr.apply': ['Apply suggestion', 'सुझाव लगाएँ'],
  'dr.applied': ['Doctor’s suggestion applied', 'डॉक्टर का सुझाव लगाया गया'],
  'dr.fail': ['The Doctor is unavailable right now', 'डॉक्टर अभी उपलब्ध नहीं है'],
  'dr.offline': ['Offline advice', 'ऑफ़लाइन सलाह'],
  'dr.tip': ['Doctor says', 'डॉक्टर कहते हैं'],
  'dr.goal': ['Goal', 'लक्ष्य'],
  'dr.goal.balanced': ['Balanced', 'संतुलित'],
  'dr.goal.ink': ['Save ink', 'स्याही बचाएँ'],
  'dr.goal.pages': ['Fewer pages', 'कम पन्ने'],
  'dr.goal.readability': ['Easy to read', 'पढ़ने में आसान'],

  // voice commands
  'vc.title': ['Voice settings', 'आवाज़ से सेटिंग'],
  'vc.start': ['Speak a command', 'कमांड बोलें'],
  'vc.stop': ['Listening… tap to stop', 'सुन रहे हैं… रोकने के लिए दबाएँ'],
  'vc.processing': ['Understanding…', 'समझ रहे हैं…'],
  'vc.applied': ['Applied: {n}', 'लगाया: {n}'],
  'vc.heard': ['Heard: “{n}”', 'सुना: “{n}”'],
  'vc.fail': ['Could not hear a command', 'कोई कमांड समझ नहीं आया'],
  'vc.nomic': ['Microphone not available — use the website in a normal browser', 'माइक उपलब्ध नहीं — सामान्य ब्राउज़र में वेबसाइट खोलें'],
  'vc.hint': ['Try: “four up”, “grayscale”, “save ink”, “booklet”, “searchable”', 'आज़माएँ: “चार अप”, “ग्रेस्केल”, “स्याही बचाओ”, “बुकलेट”'],

  // spoken receipt (TTS)
  'rs.listen': ['Listen', 'सुनें'],
  'rs.stop': ['Stop', 'रोकें'],
  'rs.loading': ['Generating audio…', 'ऑडियो बन रहा है…'],
  'rs.listenFail': ['Could not generate audio', 'ऑडियो नहीं बना'],

  // QR share
  'pr.qr': ['QR code', 'QR कोड'],
  'pr.qr.title': ['Scan to load this preset', 'स्कैन करें और प्रीसेट लोड करें'],
  'pr.qr.sub': ['Point another phone’s camera at the code — the preset opens in its browser.', 'दूसरे फ़ोन का कैमरा कोड पर ले जाएँ — प्रीसेट उसके ब्राउज़र में खुल जाएगा।'],
  'pr.qr.fail': ['Could not draw the QR code', 'QR कोड नहीं बना'],
  'pr.qr.copy': ['Copy link', 'लिंक कॉपी करें'],
  'pr.qr.copied': ['Link copied', 'लिंक कॉपी हो गया'],

  // impact dashboard section
  'db.eyebrow': ['Impact dashboard', 'असर डैशबोर्ड'],
  'db.title': ['Your print savings', 'आपकी प्रिंट बचत'],
  'db.sub': ['Private, on-device totals — visible only to you.', 'प्राइवेट, डिवाइस पर सेव — सिर्फ़ आपके लिए।'],
  'db.empty': ['Process your first PDF and your savings will appear here.', 'पहली PDF प्रोसेस करें — बचत यहाँ दिखने लगेगी।'],
  'db.sheets': ['Sheets saved', 'शीट बचीं'],
  'db.rupees': ['Money saved', 'पैसे बचे'],
  'db.co2': ['CO₂ avoided', 'CO₂ बची'],
  'db.trees': ['Tree equivalent', 'पेड़ बराबर'],
  'db.jobs': ['Conversions', 'कन्वर्ज़न'],
  'db.weeks': ['Last 8 weeks', 'पिछले 8 सप्ताह'],
  'db.week': ['wk {n}', 'सप्ताह {n}'],
  'db.thisweek': ['This week', 'इस सप्ताह'],
  'db.reset': ['Reset all impact data', 'सारा असर डेटा रीसेट करें'],
  'db.resetDone': ['Impact data cleared', 'असर डेटा मिटा दिया गया'],

  // badge gallery
  'bg.title': ['Badges', 'बैज'],
  'bg.sub': ['Collect them as you save paper', 'कागज़ बचाते जाइए और जमा करते जाइए'],
  'bg.locked': ['Locked', 'बंद'],
  'bg.first': ['First Print', 'पहली छपाई'],
  'bg.firstD': ['Finish your first conversion', 'पहला कन्वर्ज़न पूरा करें'],
  'bg.ten': ['Regular', 'नियमित'],
  'bg.tenD': ['Finish 10 conversions', '10 कन्वर्ज़न पूरे करें'],
  'bg.fifty': ['Workhorse', 'मेहनती'],
  'bg.fiftyD': ['Finish 50 conversions', '50 कन्वर्ज़न पूरे करें'],
  'bg.s50': ['Paper Saver', 'कागज़ रक्षक'],
  'bg.s50D': ['Save 50 sheets', '50 शीट बचाएँ'],
  'bg.s250': ['Grove Keeper', 'वृक्ष रक्षक'],
  'bg.s250D': ['Save 250 sheets', '250 शीट बचाएँ'],
  'bg.s1000': ['Forest Legend', 'वन लीजेंड'],
  'bg.s1000D': ['Save 1,000 sheets', '1,000 शीट बचाएँ'],
  'bg.w2': ['Warm-up', 'वॉर्म-अप'],
  'bg.w2D': ['2-week streak', '2 सप्ताह की स्ट्रीक'],
  'bg.w4': ['Habit', 'आदत'],
  'bg.w4D': ['4-week streak', '4 सप्ताह की स्ट्रीक'],
  'bg.w8': ['Unstoppable', 'अजेय'],
  'bg.w8D': ['8-week streak', '8 सप्ताह की स्ट्रीक'],

  // smart page picks
  'pg.pick': ['Quick pick', 'क्विक पिक'],
  'pg.pick.odd': ['Odd pages', 'सम नहीं (1,3…)'],
  'pg.pick.even': ['Even pages', 'सम पन्ने (2,4…)'],
  'pg.pick.invert': ['Invert selection', 'उल्टा चुनें'],
  'pg.pick.last': ['Last 10', 'आख़िरी 10'],
  'pg.pick.all': ['All', 'सभी'],

  // shortcuts help
  'kb.title': ['Keyboard shortcuts', 'कीबोर्ड शॉर्टकट'],
  'kb.k': ['Command menu', 'कमांड मेनू'],
  'kb.flip': ['Light / dark flip', 'लाइट / डार्क बदलें'],
  'kb.q': ['This help', 'यह मदद'],
  'kb.esc': ['Close dialogs', 'डायलॉग बंद करें'],
  'kb.open': ['Shortcuts', 'शॉर्टकट'],

  // welcome tour
  'tour.aria': ['Welcome tour', 'स्वागत टूर'],
  'tour.skip': ['Skip', 'छोड़ें'],
  'tour.back': ['Back', 'पीछे'],
  'tour.next': ['Next', 'आगे'],
  'tour.stepN': ['Step {n} of {m}', 'चरण {n} / {m}'],
  'tour.s1.t': ['Welcome to Printifier', 'Printifier में आपका स्वागत है'],
  'tour.s1.b': [
    'Turn heavy lecture PDFs into printer-friendly sheets — more slides per page, less ink, brighter prints. Everything runs right here in your browser; your files never leave your device.',
    'भारी लेक्चर PDF को प्रिंटर-फ्रेंडली शीट में बदलें — एक पेज पर ज़्यादा स्लाइड, कम स्याही, चमकदार प्रिंट। सब कुछ यहीं आपके ब्राउज़र में चलता है; आपकी फ़ाइलें डिवाइस से बाहर नहीं जातीं।',
  ],
  'tour.s1.c1': ['N-up layouts', 'N-up लेआउट'],
  'tour.s1.c2': ['Ink saver', 'स्याही बचाना'],
  'tour.s1.c3': ['Booklet mode', 'बुकलेट मोड'],
  'tour.s1.c4': ['100% private', '100% निजी'],
  'tour.s2.t': ['Make it yours', 'इसे अपना बनाएँ'],
  'tour.s2.b': [
    'Pick a look — the whole app follows instantly. 12 themes and 10 backdrop patterns live in the palette button up top, or press ⌘K / Ctrl+K anytime.',
    'एक रूप चुनें — पूरा ऐप तुरंत बदल जाएगा। 12 थीम और 10 बैकड्रॉप पैटर्न ऊपर पैलेट बटन में हैं, या कभी भी ⌘K / Ctrl+K दबाएँ।',
  ],
  'tour.s2.hint': ['Tap a swatch to try it right now', 'अभी आज़माने के लिए रंग दबाएँ'],
  'tour.s3.t': ['A real example', 'असली उदाहरण'],
  'tour.s3.b': [
    'This is a real 41-page dark lecture PDF, processed with the default recipe (inverted, ink-saver, 3 slides per sheet). Nothing staged.',
    'यह असली 41-पेज की गहरी लेक्चर PDF है — डिफ़ॉल्ट रेसिपी से प्रोसेस की गई (इनवर्ट, स्याही-बचत, प्रति शीट 3 स्लाइड)। कुछ भी दिखावा नहीं।',
  ],
  'tour.s3.before': ['Before · {n} sheets', 'पहले · {n} शीट'],
  'tour.s3.after': ['After · {n} pages', 'बाद · {n} पेज'],
  'tour.s3.pages': ['−{n}% pages', '−{n}% पेज'],
  'tour.s3.ink': ['−~87% ink', '−~87% स्याही'],
  'tour.s3.load': ['Load this PDF & try it', 'यह PDF लोड करें और आज़माएँ'],
  'tour.s3.full': ['Browse the full before & after', 'पूरा पहले/बाद देखें'],
  'tour.s4.t': ['Your turn', 'अब आपकी बारी'],
  'tour.s4.b': [
    'Drop any lecture PDF, tune the sliders, and download a print-ready file. Three steps: upload → enhance → print.',
    'कोई भी लेक्चर PDF डालें, स्लाइडर सेट करें और प्रिंट-रेडी फ़ाइल डाउनलोड करें। तीन चरण: अपलोड → सुधार → प्रिंट।',
  ],
  'tour.s4.s1': ['Upload your PDF', 'अपनी PDF अपलोड करें'],
  'tour.s4.s2': ['Enhance & lay out', 'सुधारें और लेआउट बनाएँ'],
  'tour.s4.s3': ['Print or share it', 'प्रिंट करें या शेयर करें'],
  'tour.s4.cta': ['Try it yourself', 'खुद आज़माएँ'],
  'tour.s4.sample': ['Load the sample PDF', 'सैंपल PDF लोड करें'],
  'cp.tour': ['Replay the intro tour', 'इंट्रो टूर दोबारा देखें'],
};

interface LangState {
  lang: Lang;
  hydrated: boolean;
  setLang: (l: Lang) => void;
  hydrate: () => void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: 'en',
  hydrated: false,
  setLang: (l) => {
    set({ lang: l });
    try {
      window.localStorage.setItem(LS_KEY, l);
    } catch {
      // private mode
    }
  },
  hydrate: () => {
    try {
      const saved = window.localStorage.getItem(LS_KEY);
      if (saved === 'hi' || saved === 'en') set({ lang: saved, hydrated: true });
      else set({ hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function useT(): Translate {
  const lang = useLangStore((s) => s.lang);
  return (key, vars) => {
    const entry = DICT[key];
    let out = entry ? entry[lang === 'hi' ? 1 : 0] : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replaceAll(`{${k}}`, String(v));
      }
    }
    return out;
  };
}

/** Translate outside React (rare — toasts from store code). */
export function translateStatic(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let out = entry ? entry[lang === 'hi' ? 1 : 0] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

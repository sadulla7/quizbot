from playwright.sync_api import sync_playwright
BASE='http://localhost:8787'; DOCX='/home/claude/quizbot/tests/fixtures/logistika-1-100.docx'
probs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':860})
    pg.on('console',lambda m: probs.append('console.'+m.type+': '+m.text) if m.type in('error','warning') else None)
    pg.on('pageerror',lambda e: probs.append('pageerror: '+str(e)))
    pg.goto(BASE+'/'); pg.wait_for_selector('.center'); print('1 kirishsiz:', pg.inner_text('.center h1'))
    pg.goto(BASE+'/dev/login'); pg.wait_for_selector('.stats'); print('2 testlar:', pg.inner_text('h1'), '|', pg.inner_text('.stats').replace('\n',' ')[:60])
    pg.click('text=Fayldan test yaratish'); pg.wait_for_selector('.drop')
    pg.set_input_files('input[type=file]', DOCX); pg.wait_for_selector('.key')
    print('3 import:', pg.inner_text('p[aria-live]'), '| qizil kataklar:', pg.locator('.key span.bad').count(), '| saqlash:', pg.inner_text('.savebar button'), '| disabled:', pg.is_disabled('.savebar button'))
    pg.locator('.q.bad input[type=radio]').nth(2).check()  # #83 ga C
    print('   tuzatgach:', pg.inner_text('.savebar button'), '| disabled:', pg.is_disabled('.savebar button'))
    pg.screenshot(path='/tmp/s-import.png')
    pg.click('.savebar button'); pg.wait_for_url('**/#/test/*'); pg.wait_for_selector('.q')
    print('4 test sahifasi:', pg.inner_text('h1'), '| savollar:', pg.locator('.card.q').count(), '|', pg.inner_text('.chip').strip())
    pg.click('text=E\'lon qilish'); pg.wait_for_selector('.chip.ok'); print('5 e\'lon:', pg.inner_text('.chip.ok'))
    pg.screenshot(path='/tmp/s-test.png')
    for w in (390,):
        pg.set_viewport_size({'width':w,'height':800})
        for h in ('#/','#/import','#/test/1'):
            pg.goto(BASE+'/'+h); pg.wait_for_timeout(400)
            sw=pg.evaluate('document.documentElement.scrollWidth'); print('   mobil',h,'scrollWidth',sw,'(<=390 kerak)' if sw>390 else 'ok')
    t=pg.evaluate('document.body.innerText')
    import re
    for w in ('null','undefined','NaN','[object'):
        if re.search(r'(^|[^a-zA-Z])'+re.escape(w)+r'([^a-zA-Z]|$)',t): probs.append('sahifada '+w)
    b.close()
print('MUAMMOLAR:', probs or "yo'q")

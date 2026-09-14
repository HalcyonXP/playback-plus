"""Check the staged/live demo in disposable headless Firefox and Edge.
Requires Selenium, websocket-client, installed browsers and cached geckodriver;
no downloads, user profiles or real audio. Build via tools/build_demo.py first.
"""
from pathlib import Path
import argparse,subprocess,tempfile,time,json,urllib.request,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from functools import partial
import websocket
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.keys import Keys
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.pi/demo-smoke';OUT.mkdir(parents=True,exist_ok=True);PALETTES=json.loads((ROOT/'demo/palettes.json').read_text())
parser=argparse.ArgumentParser();parser.add_argument('--url');parser.add_argument('--label',default='local');args=parser.parse_args()
requests=[]
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  requests.append(self.path)
  if not self.path.startswith('/playback-plus/'):
   self.send_error(404);return
  self.path=self.path[len('/playback-plus'):]
  super().do_GET()
server=None
if args.url:URL=args.url
else:
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'.pi/pages-site')))
 threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/playback-plus/demo/'
def poll(fn,timeout=15):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if fn():return
  time.sleep(.05)
 raise AssertionError('Timed out waiting for demo state')
def suite(parent,child):
 poll(lambda:parent('document.documentElement.dataset.appliedTheme')=='n1')
 poll(lambda:child("!document.getElementById('saveDefault').disabled && !document.getElementById('audioExact').disabled"))
 child("document.getElementById('saveDefault').click()")
 poll(lambda:child("document.getElementById('defaultSpeed').textContent")=='2×')
 child("document.getElementById('increaseButton').click()")
 poll(lambda:child("document.getElementById('speedValue').textContent")=='2.25×')
 for key,details in PALETTES.items():
  parent(f'document.querySelector(\'button[data-theme="{key}"]\').click()')
  poll(lambda:parent('document.documentElement.dataset.appliedTheme')==key)
  assert child('document.documentElement.dataset.theme')==key
  assert child("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == details['accent']
  assert child("!document.getElementById('mainView').hidden")
  assert child("document.getElementById('speedValue').textContent")=='2.25×'
  assert child("document.getElementById('defaultSpeed').textContent")=='2×'
  assert parent("document.querySelectorAll('button[aria-pressed=true]').length")==1
  child("document.getElementById('audioInfo').click()")
  assert child("!document.getElementById('audioDetails').hidden && document.getElementById('audioSafety').getBoundingClientRect().height>0")
  child("document.getElementById('audioInfo').click()")
  assert parent("new URL(document.getElementById('paletteLink').href).searchParams.get('theme')")==key
 parent("document.getElementById('preview').contentWindow.postMessage({type:'PLAYBACK_PLUS_THEME_SELECT',theme:'invalid'},location.origin)")
 time.sleep(.1);assert child('document.documentElement.dataset.theme')=='gb3'
 parent("['n2','go3','gb1','n3','gb2'].forEach(k=>document.querySelector('button[data-theme='+k+']').click())")
 poll(lambda:parent('document.documentElement.dataset.appliedTheme')=='gb2')
 # Exercise fake controls, safety wording, navigation and stable shortcut capture.
 child("document.getElementById('audioIncrease').click()")
 poll(lambda:child("document.getElementById('audioExact').value")=='500')
 child("document.getElementById('audioEnabled').click()")
 poll(lambda:child("document.getElementById('audioEnabled').getAttribute('aria-checked')")=='true')
 child("document.getElementById('audioInfo').click()")
 assert child("document.getElementById('audioSafety').getBoundingClientRect().height>0")
 child("document.getElementById('audioInfo').click()")
 child("document.getElementById('dialogueEnabled').click()")
 poll(lambda:child("document.getElementById('dialogueEnabled').getAttribute('aria-checked')")=='true')
 child("document.getElementById('dialogueInfo').click()")
 assert child("document.getElementById('dialogueSafety').getBoundingClientRect().height>0")
 child("document.getElementById('configButton').click()")
 assert child("document.getElementById('dialogueDetails').hidden"), 'Configuration closes info'
 child("document.getElementById('audioIncreaseKeyButton').click()")
 assert child("document.getElementById('audioIncreaseKeyButton').textContent")=='Press key…'
 assert child("document.getElementById('hotkeyHint').textContent")=='Choose a shortcut. Press a key. Escape clears it.'
 # Automatic resources stay on the hosting origin (including a browser favicon probe).
 for resources in [parent("performance.getEntriesByType('resource').map(r=>r.name)"),child("performance.getEntriesByType('resource').map(r=>r.name)")]:
  assert all(url.startswith(URL.split('/playback-plus/')[0]+'/') for url in resources),resources
 return {'nine_palette_css_changes':True,'saved_default_independent':True,'theme_switch_preserves_page_and_settings':True,'share_links':True,'invalid_theme_rejected':True,'rapid_switching':True,'unified_page_configuration_and_fake_controls':True,'safety_info_in_all_palettes':True,'no_external_automatic_resources':True}
report={'url':URL}
try:
 options=Options();options.binary_location='C:/Program Files/Firefox Developer Edition/firefox.exe';options.add_argument('-headless')
 exe=sorted((Path.home()/'.cache/selenium/geckodriver').glob('**/geckodriver.exe'))[-1]
 with webdriver.Firefox(options=options,service=Service(str(exe),popen_kw={'creation_flags':subprocess.CREATE_NO_WINDOW})) as driver:
  driver.set_window_size(1100,1100);driver.get(URL)
  def parent(expression):
   driver.switch_to.default_content();return driver.execute_script('return '+expression)
  def child(expression):
   driver.switch_to.default_content();driver.switch_to.frame('preview');return driver.execute_script('return '+expression)
  report['firefox']=suite(parent,child)
  parent("document.querySelector('[data-theme=n3]').focus()")
  driver.find_element('css selector','[data-theme=n3]').send_keys(Keys.ENTER)
  poll(lambda:parent('document.documentElement.dataset.appliedTheme')=='n3');report['firefox']['keyboard_enter']=True
  driver.get(URL+'?theme=go2');poll(lambda:parent('document.documentElement.dataset.appliedTheme')=='go2')
  poll(lambda:child("!document.getElementById('saveDefault').disabled"));assert child("document.getElementById('defaultSpeed').textContent")=='1×'
  report['firefox']['direct_palette_link_and_memory_reset']=True
  driver.switch_to.default_content();driver.save_screenshot(str(OUT/(args.label+'-desktop.png')))
  driver.set_window_size(390,950)
  assert parent('document.documentElement.scrollWidth<=innerWidth'), 'Gallery root overflows narrow viewport'
  assert child("document.querySelector('.app').getBoundingClientRect().width")==360
  report['firefox']['narrow_viewport_css_px']=parent('innerWidth')
  # Firefox's headless desktop window may clamp to a minimum wider than 390 px.
  # Independently constrain the scroll region instead of claiming a mobile viewport.
  parent("document.querySelector('.preview-scroll').style.maxWidth='358px'")
  parent("document.querySelector('.preview-scroll').scrollLeft=999")
  assert parent("document.querySelector('.preview-scroll').scrollLeft>0")
  report['firefox']['358px_preview_region_scroll']=True
 with tempfile.TemporaryDirectory(prefix='playback-plus-pages-edge-') as profile:
  process=subprocess.Popen(['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
  connection=None;sequence=0
  try:
   portfile=Path(profile)/'DevToolsActivePort';poll(portfile.exists)
   port=portfile.read_text().splitlines()[0]
   with urllib.request.urlopen('http://127.0.0.1:'+port+'/json/list',timeout=10) as response:targets=json.load(response)
   target=next(t for t in targets if t['type']=='page')
   connection=websocket.create_connection(target['webSocketDebuggerUrl'],timeout=15,suppress_origin=True)
   def command(method,params=None):
    global sequence
    sequence+=1;current=sequence;connection.send(json.dumps({'id':current,'method':method,'params':params or {}}))
    while True:
     response=json.loads(connection.recv())
     if response.get('id')==current:
      if 'error' in response:raise RuntimeError(response['error'])
      return response.get('result',{})
   command('Page.enable');command('Runtime.enable');command('Page.navigate',{'url':URL})
   def evaluate(expression,context=None):
    params={'expression':expression,'returnByValue':True}
    if context:params['contextId']=context
    result=command('Runtime.evaluate',params)
    if 'exceptionDetails' in result:raise RuntimeError(result['exceptionDetails'])
    return result.get('result',{}).get('value')
   poll(lambda:evaluate('document.documentElement?.dataset.appliedTheme')=='n1')
   def child(expression):
    frameId=command('Page.getFrameTree')['frameTree']['childFrames'][0]['frame']['id']
    context=command('Page.createIsolatedWorld',{'frameId':frameId,'worldName':'demo-verification'})['executionContextId']
    return evaluate(expression,context)
   report['edge']=suite(evaluate,child)
   evaluate("document.querySelector('[data-theme=n3]').focus()")
   command('Input.dispatchKeyEvent',{'type':'keyDown','key':'Enter','code':'Enter','windowsVirtualKeyCode':13,'text':'\r','unmodifiedText':'\r'})
   command('Input.dispatchKeyEvent',{'type':'keyUp','key':'Enter','code':'Enter','windowsVirtualKeyCode':13})
   poll(lambda:evaluate('document.documentElement.dataset.appliedTheme')=='n3');report['edge']['keyboard_enter']=True
   command('Page.navigate',{'url':URL+'?theme=go2'});poll(lambda:evaluate('document.documentElement?.dataset.appliedTheme')=='go2')
   poll(lambda:child("!document.getElementById('saveDefault').disabled"));assert child("document.getElementById('defaultSpeed').textContent")=='1×'
   report['edge']['direct_palette_link_and_memory_reset']=True
   command('Emulation.setDeviceMetricsOverride',{'width':390,'height':900,'deviceScaleFactor':1,'mobile':False})
   assert evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert child("document.querySelector('.app').getBoundingClientRect().width")==360
   evaluate("document.querySelector('.preview-scroll').scrollLeft=999")
   assert evaluate("document.querySelector('.preview-scroll').scrollLeft>0")
   report['edge']['narrow_screen_scroll']=True
  finally:
   if connection:
    try:command('Browser.close')
    except Exception:pass
    connection.close()
   try:process.wait(timeout=15)
   except subprocess.TimeoutExpired:
    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW);process.wait(timeout=10)
 report['passed']=True
finally:
 if server:server.shutdown();server.server_close()
 (OUT/(args.label+'-browser.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))

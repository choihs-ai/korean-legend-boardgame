#!/usr/bin/env python3
"""게임에 쓰인 글자만 담은 한글 웹폰트(woff2)를 Google Fonts 에서 받아 index.html 에 내장한다.

새 문구를 추가한 뒤 실행하면 빠진 글자가 시스템 글꼴로 보이는 일을 막을 수 있다.
사용: python3 tools/subset_fonts.py
"""
import base64
import pathlib
import re
import subprocess
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'index.html'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
FACES = [  # (CSS family, Google Fonts family 파라미터, weight)
    ('Black Han Sans', 'Black Han Sans', 400),
    ('IBM Plex Sans KR', 'IBM Plex Sans KR:wght@400', 400),
    ('IBM Plex Sans KR', 'IBM Plex Sans KR:wght@700', 700),
]


def used_chars() -> str:
    text = ''
    for f in [HTML, *sorted((ROOT / 'src').glob('**/*.js'))] if (ROOT / 'src').exists() else [HTML]:
        src = f.read_text(encoding='utf-8')
        src = re.sub(r'url\(data:[^)]*\)', '', src)  # 이미 내장된 폰트·이미지 데이터는 제외
        text += src
    return ''.join(sorted(set(text) - set('\n\r\t')))


def fetch(url: str) -> bytes:
    return subprocess.run(['curl', '-sS', '-m', '60', '-A', UA, url], check=True, capture_output=True).stdout


def woff2_for(family_param: str, chars: str) -> bytes:
    q = urllib.parse.urlencode({'family': family_param, 'text': chars})
    css = fetch('https://fonts.googleapis.com/css2?' + q).decode()
    src = re.search(r'url\((https://fonts\.gstatic\.com[^)]+)\)', css)
    if not src:
        raise SystemExit('폰트 주소를 찾지 못했습니다: ' + family_param)
    data = fetch(src.group(1))
    if data[:4] != b'wOF2':
        raise SystemExit('woff2 가 아닌 응답: ' + family_param)
    return data


def main() -> None:
    chars = used_chars()
    html = HTML.read_text(encoding='utf-8')
    total = 0
    for family, param, weight in FACES:
        data = woff2_for(param, chars)
        total += len(data)
        b64 = base64.b64encode(data).decode()
        pat = re.compile(r'(@font-face\{font-family:"' + re.escape(family) + r'";font-style:normal;font-weight:' + str(weight) + r';font-display:swap;src:url\(data:font/woff2;base64,)[A-Za-z0-9+/=]+(\) format\("woff2"\)\})')
        html, n = pat.subn(lambda m: m.group(1) + b64 + m.group(2), html)
        if n != 1:
            raise SystemExit(f'@font-face 블록을 찾지 못했습니다: {family} {weight}')
    HTML.write_text(html, encoding='utf-8')
    print(f'글자 {len(chars)}자, 폰트 {total // 1024}KB 내장 완료')


if __name__ == '__main__':
    main()

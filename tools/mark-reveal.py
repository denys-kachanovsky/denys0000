#!/usr/bin/env python3
"""Mark the elements that should fade in on scroll with a `data-reveal` attribute.

Usage:
    python3 tools/mark-reveal.py            # analyse only: print what would be marked / what is not covered
    python3 tools/mark-reveal.py --write    # add data-reveal to the pages (idempotent)

Rules (inside <body>):
  * a "unit" is the outermost element that is one of: image, video block, .gr-item (heading+text),
    .project-item (case card), heading / paragraph / list, .intro, .wrapper-grey
  * a unit never sits inside another unit (so nothing animates twice)
  * the sticky side navigation (.sticky), the footer and thin dividers are left alone
  * case-page header (back link + title) gets the same entrance as the home page header
"""
import glob, re, sys
from html.parser import HTMLParser

PAGES = ['index.html'] + sorted(glob.glob('*/index.html'))
VOID = {'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'}
TEXT_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol'}
UNIT_CLASSES = {'gr-item', 'project-item', 'w-background-video', 'video-con', 'intro', 'wrapper-grey', 'h3-low'}
SKIP_CLASSES = {'sticky', 'footer', 'divider', 'up'}


class Marker(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=False)
        self.src = src
        self.line_off = [0]
        for line in src.split('\n'):
            self.line_off.append(self.line_off[-1] + len(line) + 1)
        self.stack = []          # (tag, classes, role) role: 'unit' | 'skip' | 'plain'
        self.inserts = []        # (offset, text)
        self.report = []         # (tag, class, snippet)
        self.in_body = False
        self.uncovered = []

    def abs_pos(self):
        line, col = self.getpos()
        return self.line_off[line - 1] + col

    def role_of(self, tag, classes, has_reveal=False):
        cs = set(classes.split())
        if any(r == 'skip' for _, _, r in self.stack):
            return 'skip'
        if cs & SKIP_CLASSES or tag == 'footer':
            return 'skip'
        if any(r == 'unit' for _, _, r in self.stack):
            return 'plain'
        if has_reveal:
            return 'unit'
        if tag == 'img' or tag in TEXT_TAGS or cs & UNIT_CLASSES:
            return 'unit'
        return 'plain'

    def handle_starttag(self, tag, attrs):
        if tag == 'body':
            self.in_body = True
        if not self.in_body or tag in ('script', 'source', 'video', 'br'):
            if tag not in VOID:
                self.stack.append((tag, '', 'skip' if tag in ('script',) else 'plain'))
            return
        a = dict(attrs)
        classes = a.get('class', '') or ''
        role = self.role_of(tag, classes, 'data-reveal' in a)

        # header of case pages: the two wrapper blocks inside section.hero (home already has data-reveal)
        in_hero = any('hero' in c.split() and t == 'section' for t, c, _ in self.stack)
        hero_unit = False
        if in_hero and role == 'plain' and 'data-reveal' not in a:
            if tag == 'div' and (classes == '' or 'header' in classes.split()) and \
               not any(r == 'unit' for _, _, r in self.stack):
                parent = self.stack[-1] if self.stack else None
                if parent and ('w-col' in parent[1].split()):
                    hero_unit = True
        if hero_unit:
            role = 'unit'

        if role == 'unit' and 'data-reveal' not in a:
            self.inserts.append((self.abs_pos() + 1 + len(tag), ' data-reveal'))
            txt = re.sub(r'\s+', ' ', self.src[self.abs_pos(): self.abs_pos() + 400])
            self.report.append((tag, classes, txt[:70]))
        if tag not in VOID:
            self.stack.append((tag, classes, role))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if not self.in_body or not data.strip():
            return
        if any(r in ('unit', 'skip') for _, _, r in self.stack):
            return
        # text that sits directly in a plain element -> not covered by any unit
        tags = [t for t, _, _ in self.stack if t not in ('script',)]
        if tags and tags[-1] not in ('body', 'html'):
            self.uncovered.append((self.stack[-1][0], self.stack[-1][1], data.strip()[:50]))


def main():
    write = '--write' in sys.argv
    total = 0
    for path in PAGES:
        src = open(path).read()
        body_start = src.index('<body')
        m = Marker(src)
        m.feed(src)
        by_kind = {}
        for tag, cls, _ in m.report:
            key = tag + ('.' + cls.split()[0] if cls else '')
            by_kind[key] = by_kind.get(key, 0) + 1
        print(f'== {path}: {len(m.inserts)} new units')
        print('   ', ', '.join(f'{k} x{v}' for k, v in sorted(by_kind.items())))
        if m.uncovered:
            print('    TEXT NOT COVERED:')
            for u in m.uncovered:
                print('     ', u)
        total += len(m.inserts)
        if write and m.inserts:
            out = src
            for off, text in sorted(m.inserts, reverse=True):
                out = out[:off] + text + out[off:]
            open(path, 'w').write(out)
    print('total', total, '(written)' if write else '(dry run)')


if __name__ == '__main__':
    main()

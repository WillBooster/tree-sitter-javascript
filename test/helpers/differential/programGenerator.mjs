const IDS = ['a', 'b', 'c', 'x', 'y'];
const CTX_IDS = [
  'async',
  'get',
  'set',
  'of',
  'static',
  'as',
  'from',
  'target',
  'meta',
  'accessor',
  'using',
  'constructor',
];
const BIN = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
  '===',
  '!==',
  '<<',
  '>>',
  '>>>',
  '&',
  '|',
  '^',
  '&&',
  '||',
  '??',
  'in',
  'instanceof',
  ',',
];
const ASG = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??='];
const UN = ['!', '~', '+', '-', 'typeof ', 'void ', 'delete ', '- -', '+ +'];

export class ProgramGenerator {
  constructor(seed) {
    this.seed = seed >>> 0 || 1;
  }
  program() {
    const ctx = {
      top: true,
    };
    const r = this.random();
    let body;
    const n = 1 + Math.floor(this.random() * 3);
    const stmts = [];
    for (let i = 0; i < n; i++) stmts.push(this.statement(3, ctx), this.whitespace(0.5));
    if (r < 0.15) {
      const inner = {
        gen: true,
        async: this.chance(0.5),
        func: true,
      };
      body = node(
        'm',
        inner.async ? 'async ' : '',
        'function* G() {',
        this.whitespace(),
        this.statement(3, inner),
        this.whitespace(),
        this.statement(2, inner),
        '}'
      );
    } else body = node('m', ...stmts);
    return body;
  }
  random() {
    this.seed = (this.seed + 1_831_565_813) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }
  pick(a) {
    return a[Math.floor(this.random() * a.length)];
  }
  chance(p) {
    return this.random() < p;
  }
  whitespace(pNl = 0.12) {
    const r = this.random();
    if (r < pNl) return node('w', this.pick(['\n', '\n', ' \n ', '\n\n', '//c\n', '/*\n*/']));
    if (r < pNl + 0.04) return node('w', this.pick(['/*c*/', ' /*c*/ ']));
    if (r < pNl + 0.2) return node('w', '');
    return node('w', ' ');
  }
  requiredSpace() {
    return this.chance(0.08) ? node('w', this.pick(['\n', '//c\n', '/*\n*/'])) : node('w', ' ');
  }
  identifier() {
    const r = this.random();
    if (r < 0.75) return this.pick(IDS);
    return this.pick(CTX_IDS);
  }
  params() {
    const n = Math.floor(this.random() * 3);
    const ps = [];
    for (let i = 0; i < n; i++) {
      let p = this.pick(['x', 'y', '{a, b: c}', '[a, , b]', '...r', 'x = 1', '{a = 1}', 'z', 'this']);
      if (p === 'this') {
        p = 'z';
      }
      ps.push(p);
    }
    return ps.join(', ');
  }
  literal() {
    return this.pick([
      '0',
      '1',
      '.5',
      '1n',
      '0x1',
      '1e3',
      '1_0',
      '"s"',
      "'s'",
      'null',
      'true',
      'false',
      'this',
      '/r/g',
      '/[/]/',
      '`t`',
      'undefined',
    ]);
  }
  primary(d, ctx) {
    const r = this.random();
    if (r < 0.45) return node('e', this.identifier());
    if (r < 0.75) return node('e', this.literal());
    if (d <= 0) return node('e', this.identifier());
    return this.compound(d, ctx);
  }
  lhs(d, ctx) {
    switch (Math.floor(this.random() * 6)) {
      case 0: {
        return node('e', this.expression(d - 1, ctx), '.x');
      }

      case 1: {
        return node('e', this.expression(d - 1, ctx), '[', this.expression(d - 1, ctx), ']');
      }

      case 2: {
        return node('e', '[', this.identifier(), ', ...', this.identifier(), ']');
      }

      case 3: {
        return node('e', '{', this.identifier(), ', b: ', this.identifier(), '}');
      }

      case 4: {
        return node('e', '(', this.identifier(), ')');
      }

      default: {
        return node('e', this.identifier());
      }
    }
  }
  arrow(d, ctx) {
    const a = this.chance(0.25) ? 'async ' : '';
    const inner = {
      ...ctx,
      async: !!a,
      gen: false,
      func: true,
    };
    let head;
    const r = this.random();
    head = r < 0.3 ? this.identifier() : node('m', '', '(', this.params(), ')', '');
    let body;
    const b = this.random();
    body =
      b < 0.35
        ? node('m', '{', this.block(d - 1, inner), '}')
        : b < 0.45
          ? node('e', '({', this.identifier(), ': ', this.expression(d - 1, inner), '})')
          : b < 0.52
            ? node('m', '{', this.identifier(), ': ', this.expression(d - 1, inner), '}')
            : this.expression(d - 1, inner);
    return node('e', a, head, this.whitespace(0.03), '=>', this.whitespace(0.1), body);
  }
  functionExpression(d, ctx, decl) {
    const g = this.chance(0.25) ? '*' : '';
    const a = this.chance(0.25) ? 'async ' : '';
    const inner = {
      ...ctx,
      async: !!a,
      gen: !!g,
      func: true,
      loop: false,
    };
    return node(
      decl ? 's' : 'e',
      a,
      'function',
      g,
      decl ? ' ' + this.pick(['f', 'g']) : this.chance(0.4) ? ' h' : '',
      '',
      '(',
      this.params(),
      ')',
      '',
      ' {',
      this.block(d - 1, inner),
      '}'
    );
  }
  classMember(d, ctx) {
    const inner = {
      ...ctx,
      func: true,
      method: true,
      gen: false,
      async: false,
      loop: false,
    };
    const mods = [];
    if (this.chance(0.25)) {
      mods.push('static');
    }
    if (this.chance(0.05)) {
      mods.push('accessor');
    }
    const name = this.pick([
      'm',
      'n',
      '#p',
      '"s"',
      '[k]',
      '1',
      'get',
      'set',
      'static',
      'async',
      'constructor',
      'of',
      'declare',
      'readonly',
    ]);
    const pre = mods.length > 0 ? mods.join(' ') + this.pick([' ', '\n']) : '';
    switch (Math.floor(this.random() * 7)) {
      case 0: {
        return node(
          'm',
          pre,
          name,
          '',
          '',
          this.chance(0.5) ? node('m', ' = ', this.expression(d - 1, inner)) : '',
          this.pick([';', '\n', ';'])
        );
      }

      case 1: {
        return node(
          'm',
          pre,
          this.pick(['', 'async ', '*', 'get ', 'set ', 'async *']),
          name,
          '',
          '(',
          this.params(),
          ')',
          ' {',
          this.block(d - 1, inner),
          '}'
        );
      }

      case 2: {
        return node('m', 'static {', this.block(d - 1, inner), '}');
      }

      case 3: {
        return node('m', name, ';');
      }

      case 4: {
        return node('m', ';');
      }

      case 5: {
        return node('m', '', pre, name, '() {}');
      }

      default: {
        return node('m', pre, name, this.pick([';', '\n']));
      }
    }
  }
  classExpression(d, ctx, decl) {
    const members = [];
    const n = Math.floor(this.random() * 3);
    for (let i = 0; i < n; i++) members.push(this.classMember(d - 1, ctx), this.whitespace(0.3));
    const heritage = this.chance(0.3) ? node('m', ' extends ', this.expression(d - 1, ctx), '') : '';
    return node(
      decl ? 's' : 'e',
      '',
      'class',
      decl ? ' C' : this.chance(0.3) ? ' K' : '',
      '',
      heritage,
      '',
      ' {',
      this.whitespace(0.3),
      ...members,
      '}'
    );
  }
  objectLiteral(d, ctx) {
    const props = [];
    const n = Math.floor(this.random() * 4);
    for (let i = 0; i < n; i++) {
      const inner = {
        ...ctx,
        func: true,
        method: true,
        gen: false,
        async: false,
        loop: false,
      };
      let p;
      switch (Math.floor(this.random() * 9)) {
        case 0: {
          p = node('m', this.identifier());
          break;
        }

        case 1: {
          p = node('m', '...', this.expression(d - 1, ctx));
          break;
        }

        case 2: {
          p = node(
            'm',
            this.pick(['', 'async ', '*', 'get ', 'set ', 'async *']),
            this.pick(['m', 'get', 'set', 'async', '"s"', '[k]', '1']),
            '(',
            this.params(),
            ') {',
            this.block(d - 1, inner),
            '}'
          );
          break;
        }

        case 3: {
          p = node('m', '[', this.expression(d - 1, ctx), ']: ', this.expression(d - 1, ctx));
          break;
        }

        default: {
          p = node(
            'm',
            this.pick([this.identifier(), '"s"', '1', 'if', 'new', 'class']),
            this.whitespace(0.05),
            ':',
            this.whitespace(0.05),
            this.expression(d - 1, ctx)
          );
        }
      }
      props.push(p);
      if (i < n - 1) {
        props.push(',', this.whitespace(0.15));
      }
    }
    if (n && this.chance(0.15)) {
      props.push(',');
    }
    return node('e', '{', this.whitespace(0.1), ...props, this.whitespace(0.1), '}');
  }
  jsxElement(d, ctx) {
    if (d < 0) return node('e', this.pick(['<a />', '<></>', '<A.B></A.B>']));
    const name = this.pick(['div', 'A', 'A.B', 'a-b', 'a:b', 'this.x']);
    const attrs = [];
    const n = Math.floor(this.random() * 3);
    for (let i = 0; i < n; i++)
      attrs.push(
        ' ',
        this.pick([
          node('m', this.pick(['x', 'if', 'a-b', 'a:b']), '="s"'),
          node('m', 'x={', this.expression(d - 1, ctx), '}'),
          node('m', '{...', this.expression(d - 1, ctx), '}'),
          'x',
          node('m', 'x=', this.jsxElement(d - 1, ctx)),
        ])
      );
    if (this.chance(0.3)) return node('e', '<', name, ...attrs, ' />');
    const kids = [];
    const k = Math.floor(this.random() * 3);
    for (let i = 0; i < k; i++)
      kids.push(
        this.pick([
          'text',
          ' t > u ',
          node('m', '{', this.expression(d - 1, ctx), '}'),
          '{/*c*/}',
          d > 0 ? this.jsxElement(d - 1, ctx) : 'x',
          '&amp;',
          '\n',
        ])
      );
    if (this.chance(0.2)) return node('e', '<>', ...kids, '</>');
    return node('e', '<', name, ...attrs, '>', ...kids, '</', name, '>');
  }
  compound(d, ctx) {
    const e = () => this.expression(d - 1, ctx);
    const r = Math.floor(this.random() * 40);
    switch (r) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4: {
        return node('e', e(), this.whitespace(), this.pick(BIN), this.whitespace(), e());
      }

      case 5: {
        return node('e', this.lhs(d, ctx), this.whitespace(0.05), this.pick(ASG), this.whitespace(), e());
      }

      case 6: {
        return node('e', this.pick(UN), this.whitespace(0.05), e());
      }

      case 7: {
        return this.chance(0.5)
          ? node('e', this.pick(['++', '--']), this.whitespace(0.05), this.lhs(d, ctx))
          : node('e', this.lhs(d, ctx), this.whitespace(0.15), this.pick(['++', '--']));
      }

      case 8: {
        return node(
          'e',
          e(),
          this.whitespace(),
          '?',
          this.whitespace(),
          e(),
          this.whitespace(),
          ':',
          this.whitespace(),
          e()
        );
      }

      case 9:
      case 10: {
        return node(
          'e',
          e(),
          this.whitespace(0.08),
          this.pick(['(', '?.(']),
          this.chance(0.3) ? '' : e(),
          this.chance(0.2) ? node('m', ', ...', e()) : '',
          ')'
        );
      }

      case 11: {
        return node(
          'e',
          e(),
          this.whitespace(0.08),
          this.pick(['.', '?.']),
          this.whitespace(0.05),
          this.pick(['x', 'if', 'new', 'class', '#p', 'await', 'yield', 'get'])
        );
      }

      case 12: {
        return node('e', e(), this.whitespace(0.08), this.pick(['[', '?.[']), e(), ']');
      }

      case 13: {
        return node('e', 'new ', e(), this.chance(0.5) ? node('m', '(', this.chance(0.5) ? '' : e(), ')') : '');
      }

      case 14: {
        return node('e', e(), this.whitespace(0.08), this.pick(['`t`', node('m', '`a${', e(), '}b`')]));
      }

      case 15: {
        return node('e', '(', this.whitespace(0.05), e(), this.whitespace(0.05), ')');
      }

      case 16: {
        return node(
          'e',
          '[',
          this.chance(0.3) ? '' : e(),
          this.pick(['', ', ', ', , ']),
          this.chance(0.4) ? node('m', '...', e()) : '',
          ']'
        );
      }

      case 17: {
        return this.objectLiteral(d, ctx);
      }

      case 18:
      case 19: {
        return this.arrow(d, ctx);
      }

      case 20: {
        return this.functionExpression(d, ctx, false);
      }

      case 21: {
        return this.classExpression(d, ctx, false);
      }

      case 22: {
        return ctx.async || ctx.top ? node('e', 'await', this.whitespace(0.08), e()) : node('e', 'a');
      }

      case 23: {
        return ctx.gen
          ? node('e', 'yield', this.pick(['', '*', ' ', '\n']), this.chance(0.2) ? '' : node('m', ' ', e()))
          : node('e', 'a');
      }

      case 24: {
        return node('e', '`a${', e(), '}b${', e(), '}`');
      }

      case 25: {
        return node('e', this.pick(['import(', 'import.meta', 'new.target', 'super.x', 'super(', 'import.meta.x']), '');
      }

      case 26: {
        return node('e', 'import(', e(), ')');
      }

      case 27: {
        return node('e', e(), ', ', e());
      }

      case 28: {
        return node(
          'e',
          'new ',
          this.identifier(),
          this.whitespace(0.05),
          '.',
          this.whitespace(0.05),
          this.identifier(),
          '(',
          ')'
        );
      }

      case 29: {
        return this.jsxElement(d, ctx);
      }

      case 30: {
        return node('e', this.identifier(), this.whitespace(0.05), '=>', this.whitespace(), e());
      }

      case 31: {
        return node(
          'e',
          'async',
          this.pick([' ', '\n', ' ']),
          this.identifier(),
          this.whitespace(0.05),
          '=>',
          this.whitespace(),
          e()
        );
      }

      case 32: {
        return node('e', 'async', this.whitespace(0.05), '(', e(), ')');
      }

      case 33: {
        return node(
          'e',
          e(),
          this.whitespace(),
          this.pick(['/', '/=']),
          this.whitespace(0.05),
          e(),
          this.whitespace(),
          '/',
          this.pick(['', 'g', ' '])
        );
      }

      case 34: {
        return node('e', '#p in ', e());
      }

      case 35: {
        return node('e', e(), '?.', this.whitespace(0.05), '#p');
      }

      case 36: {
        return node('e', 'new ', e(), '?.', 'x');
      }

      case 37: {
        return node('e', 'async ', '(', this.params(), ')', this.whitespace(0.05), '=>', this.whitespace(), e());
      }

      case 38: {
        return node('e', e(), this.whitespace(), this.pick(['++', '--']), this.whitespace(), e());
      }

      case 39: {
        return node('e', this.pick(['let', 'yield', 'await', 'async', 'of', 'static', 'implements', 'package']));
      }
    }
  }
  expression(d, ctx) {
    if (d <= 0) return this.primary(0, ctx);
    return this.chance(0.3) ? this.primary(d, ctx) : this.compound(d, ctx);
  }
  semicolon() {
    const r = this.random();
    if (r < 0.5) return ';';
    if (r < 0.8) return node('w', '\n');
    return node('w', this.pick([' ', '', '//c\n', '/*\n*/']));
  }
  variableDeclaration(d, ctx) {
    const kind = this.pick(['let', 'const', 'var', 'let', 'using', 'await using']);
    const n = 1 + Math.floor(this.random() * 2);
    const ds = [];
    for (let i = 0; i < n; i++) {
      const name = this.pick(['x', 'y', '[a, b]', '{a, b: c}', this.identifier()]);
      ds.push(
        node(
          'm',
          name,
          '',
          this.chance(0.8)
            ? node('m', this.whitespace(0.04), '=', this.whitespace(0.08), this.expression(d - 1, ctx))
            : ''
        )
      );
      if (i < n - 1) {
        ds.push(',', this.whitespace(0.15));
      }
    }
    return node('s', kind, ' ', ...ds, this.semicolon());
  }
  statement(d, ctx) {
    const e = () => this.expression(d - 1, ctx);
    const r = Math.floor(this.random() * 26);
    switch (r) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5: {
        return node('s', e(), this.semicolon());
      }

      case 6: {
        return node('s', '{', this.whitespace(), this.block(d - 1, ctx), this.whitespace(), '}');
      }

      case 7: {
        return node(
          's',
          this.pick(['a', 'b', 'async', 'L', 'get', 'of', 'yield', 'await', 'type', 'declare']),
          this.whitespace(0.05),
          ':',
          this.whitespace(),
          this.statement(d - 1, {
            ...ctx,
            label: true,
          })
        );
      }

      case 8: {
        return node(
          's',
          'if',
          this.whitespace(0.05),
          '(',
          e(),
          ')',
          this.whitespace(),
          this.statement(d - 1, ctx),
          this.chance(0.4) ? node('m', this.whitespace(), 'else', this.requiredSpace(), this.statement(d - 1, ctx)) : ''
        );
      }

      case 9: {
        return node(
          's',
          'for',
          this.whitespace(0.03),
          '(',
          this.pick([node('m', this.chance(0.5) ? e() : this.variableDeclaration(d - 1, ctx), ';'), ';']),
          this.chance(0.5) ? e() : '',
          ';',
          this.chance(0.5) ? e() : '',
          ')',
          this.whitespace(),
          this.statement(d - 1, {
            ...ctx,
            loop: true,
          })
        );
      }

      case 10: {
        return node(
          's',
          'for',
          this.chance(0.2) && (ctx.async || ctx.top) ? ' await' : '',
          ' (',
          this.pick(['let x', 'const [a]', 'x', 'a.b', 'var x', 'async', 'let', 'of', 'using x']),
          ' ',
          this.pick(['of', 'in']),
          ' ',
          e(),
          ')',
          this.whitespace(),
          this.statement(d - 1, {
            ...ctx,
            loop: true,
          })
        );
      }

      case 11: {
        return node(
          's',
          'while (',
          e(),
          ')',
          this.whitespace(),
          this.statement(d - 1, {
            ...ctx,
            loop: true,
          })
        );
      }

      case 12: {
        return node(
          's',
          'do',
          this.requiredSpace(),
          this.statement(d - 1, {
            ...ctx,
            loop: true,
          }),
          this.whitespace(),
          'while (',
          e(),
          ')',
          this.semicolon()
        );
      }

      case 13: {
        return ctx.func
          ? node('s', 'return', this.pick([' ', '\n', ' ', '']), this.chance(0.3) ? '' : e(), this.semicolon())
          : node('s', 'throw ', e(), this.semicolon());
      }

      case 14: {
        return node('s', 'throw ', e(), this.semicolon());
      }

      case 15: {
        return node(
          's',
          'try {',
          this.block(d - 1, ctx),
          '}',
          this.whitespace(),
          this.pick([
            node('m', 'catch', this.chance(0.3) ? '' : ' (e)', ' {', this.block(d - 1, ctx), '}'),
            node('m', 'finally {', this.block(d - 1, ctx), '}'),
          ])
        );
      }

      case 16: {
        return node(
          's',
          'switch (',
          e(),
          ') {',
          this.whitespace(),
          'case ',
          e(),
          ':',
          this.whitespace(),
          this.block(d - 1, ctx),
          this.chance(0.5) ? node('m', 'default:', this.whitespace(), this.statement(d - 1, ctx)) : '',
          '}'
        );
      }

      case 17:
      case 18: {
        return this.variableDeclaration(d, ctx);
      }

      case 19: {
        return this.functionExpression(d, ctx, true);
      }

      case 20: {
        return this.classExpression(d, ctx, true);
      }

      case 21: {
        return ctx.loop
          ? node('s', this.pick(['break', 'continue']), this.pick(['', ' a', '\na']), this.semicolon())
          : node('s', ';');
      }

      case 22: {
        return node('s', ';');
      }

      case 23: {
        return node(
          's',
          this.pick([
            'let',
            'async',
            'yield',
            'await',
            'get',
            'static',
            'of',
            'using',
            'let\n[a]',
            'async\nfunction f() {}',
          ]),
          this.semicolon()
        );
      }

      case 24: {
        return ctx.top
          ? node(
              's',
              this.pick([
                'export ',
                'export default ',
                'import ',
                'import x from "m"',
                'import {x as y} from "m"',
                'export {x as default}',
                'export * as ns from "m"',
              ]),
              this.pick([e(), '', this.functionExpression(d - 1, ctx, true), this.classExpression(d - 1, ctx, true)]),
              this.semicolon()
            )
          : node('s', ';');
      }

      case 25: {
        return node(
          's',
          '@',
          this.pick(['d', 'd()', 'd.e', '(d)']),
          this.requiredSpace(),
          this.classExpression(d - 1, ctx, true)
        );
      }
    }
  }
  block(d, ctx) {
    const n = Math.floor(this.random() * 3);
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.statement(Math.max(d, 0), ctx), this.whitespace(0.4));
    return node('m', ...out);
  }
}
function node(c, ...p) {
  return { c, p };
}
export function render(n) {
  if (typeof n === 'string') return n;
  if (n.r !== void 0) return n.r;
  return n.p.map(render).join('');
}

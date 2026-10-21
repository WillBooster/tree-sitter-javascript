import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { parse } from '@babel/parser';
import { SourceTextModule } from 'node:vm';

const JsxParser = Parser.extend(jsx());
const statements = {
  ExpressionStatement: 'S',
  BlockStatement: 'Blk',
  StaticBlock: 'SBlk',
  LabeledStatement: 'L',
  IfStatement: 'If',
  ForStatement: 'For',
  ForInStatement: 'ForIn',
  ForOfStatement: 'ForOf',
  WhileStatement: 'While',
  DoWhileStatement: 'Do',
  ReturnStatement: 'Ret',
  ThrowStatement: 'Throw',
  TryStatement: 'Try',
  SwitchStatement: 'Sw',
  FunctionDeclaration: 'FnD',
  ClassDeclaration: 'ClsD',
  BreakStatement: 'Brk',
  ContinueStatement: 'Cont',
  ImportDeclaration: 'ImpD',
  ExportNamedDeclaration: 'ExpD',
  ExportDefaultDeclaration: 'ExpD',
  ExportAllDeclaration: 'ExpD',
  MethodDefinition: 'Meth',
  PropertyDefinition: 'Fld',
  SpreadElement: '...',
  RestElement: '...',
};
const expressions = {
  Literal: 'Lit',
  TemplateLiteral: 'Tpl',
  TaggedTemplateExpression: 'Tag',
  AssignmentPattern: 'A=',
  ConditionalExpression: '?:',
  CallExpression: 'C',
  ImportExpression: 'Imp',
  NewExpression: 'N',
  SequenceExpression: ',',
  ArrowFunctionExpression: '=>',
  ClassExpression: 'Cls',
  ObjectExpression: 'Obj',
  ObjectPattern: 'Obj',
  ArrayExpression: 'Arr',
  ArrayPattern: 'Arr',
  Property: 'Prop',
  AwaitExpression: 'Aw',
  MetaProperty: 'Meta',
  JSXElement: 'JSX',
  JSXFragment: 'JSX',
  JSXSpreadAttribute: 'JExpr',
  JSXSpreadChild: 'JExpr',
  JSXAttribute: 'JAttr',
};

export function referenceSignature(source) {
  let ast;
  try {
    ast = JsxParser.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    parse(source, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
  } catch {
    return;
  }
  const signature = [],
    nodes = [{ node: ast }];
  let hasJsx = false;
  while (nodes.length > 0) {
    const { node, parent, key } = nodes.pop();
    hasJsx ||= node.type.startsWith('JSX');
    const statement = statements[node.type];
    if (statement) signature.push(`${statement}@${node.start}`);
    if (node.type === 'StaticBlock') signature.push(`Blk@${source.indexOf('{', node.start)}`);
    if (
      node.type === 'VariableDeclaration' &&
      !(key === 'left' && ['ForInStatement', 'ForOfStatement'].includes(parent?.type))
    )
      signature.push(`Var@${node.start}`);
    const expression = expressions[node.type] ?? expressionKind(node, parent);
    if (expression) signature.push(`${expression}@${node.start}-${node.end}`);
    for (const [field, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) nodes.push({ node: child, parent: node, key: field });
      } else if (value?.type) nodes.push({ node: value, parent: node, key: field });
    }
  }
  if (!hasJsx) {
    try {
      new SourceTextModule(source);
    } catch {
      return;
    }
  }
  return signature.toSorted();
}

function expressionKind(node, parent) {
  switch (node.type) {
    case 'BinaryExpression':
    case 'LogicalExpression': {
      return `B${node.operator}`;
    }
    case 'AssignmentExpression': {
      return `A${node.operator}`;
    }
    case 'UnaryExpression': {
      return `U${node.operator}`;
    }
    case 'UpdateExpression': {
      return `${node.operator}${node.prefix ? 'pre' : 'post'}`;
    }
    case 'MemberExpression': {
      return node.computed ? 'M[]' : 'M.';
    }
    case 'FunctionExpression': {
      return parent?.type === 'MethodDefinition' ||
        (parent?.type === 'Property' && (parent.method || parent.kind !== 'init'))
        ? undefined
        : 'F';
    }
    case 'YieldExpression': {
      return node.delegate ? 'Y*' : 'Y';
    }
    case 'JSXExpressionContainer': {
      return node.expression.type === 'JSXEmptyExpression' ? undefined : 'JExpr';
    }
    default: {
      return;
    }
  }
}

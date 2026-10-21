const statements = {
  expression_statement: 'S',
  statement_block: 'Blk',
  class_static_block: 'SBlk',
  labeled_statement: 'L',
  if_statement: 'If',
  for_statement: 'For',
  while_statement: 'While',
  do_statement: 'Do',
  return_statement: 'Ret',
  throw_statement: 'Throw',
  try_statement: 'Try',
  switch_statement: 'Sw',
  lexical_declaration: 'Var',
  variable_declaration: 'Var',
  using_declaration: 'Var',
  function_declaration: 'FnD',
  generator_function_declaration: 'FnD',
  class_declaration: 'ClsD',
  break_statement: 'Brk',
  continue_statement: 'Cont',
  import_statement: 'ImpD',
  field_definition: 'Fld',
  rest_pattern: '...',
};
const expressions = {
  number: 'Lit',
  string: 'Lit',
  regex: 'Lit',
  true: 'Lit',
  false: 'Lit',
  null: 'Lit',
  template_string: 'Tpl',
  assignment_expression: 'A=',
  assignment_pattern: 'A=',
  ternary_expression: '?:',
  new_expression: 'N',
  subscript_expression: 'M[]',
  arrow_function: '=>',
  function_expression: 'F',
  generator_function: 'F',
  class: 'Cls',
  object: 'Obj',
  object_pattern: 'Obj',
  array: 'Arr',
  array_pattern: 'Arr',
  pair: 'Prop',
  pair_pattern: 'Prop',
  shorthand_property_identifier: 'Prop',
  await_expression: 'Aw',
  meta_property: 'Meta',
  jsx_element: 'JSX',
  jsx_self_closing_element: 'JSX',
  jsx_attribute: 'JAttr',
};

export function treeSignature(tree) {
  const signature = [],
    nodes = [tree.rootNode];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (node.isError || node.isMissing) signature.push('ERR');
    if (node.isNamed) {
      const statement = statements[node.type];
      if (statement) signature.push(`${statement}@${node.startIndex}`);
      const expression = expressions[node.type] ?? expressionKind(node);
      if (expression) signature.push(`${expression}@${node.startIndex}-${node.endIndex}`);
      addSpecialSignature(signature, node);
    }
    nodes.push(...node.children);
  }
  return signature.toSorted();
}

function expressionKind(node) {
  const operator = () => node.childForFieldName('operator').type;
  switch (node.type) {
    case 'binary_expression': {
      return `B${operator()}`;
    }
    case 'augmented_assignment_expression': {
      return `A${operator()}`;
    }
    case 'unary_expression': {
      return `U${operator()}`;
    }
    case 'update_expression': {
      return `${operator()}${node.firstChild.type === operator() ? 'pre' : 'post'}`;
    }
    case 'call_expression': {
      return node.childForFieldName('arguments')?.type === 'template_string'
        ? 'Tag'
        : node.childForFieldName('function')?.type === 'import'
          ? 'Imp'
          : 'C';
    }
    case 'method_definition': {
      return node.parent.type === 'object' ? 'Prop' : undefined;
    }
    case 'member_expression': {
      return isJsxName(node) ? undefined : 'M.';
    }
    case 'sequence_expression': {
      return node.parent.type === 'sequence_expression' ? undefined : ',';
    }
    case 'shorthand_property_identifier_pattern': {
      return node.parent.type === 'object_assignment_pattern' ? undefined : 'Prop';
    }
    case 'yield_expression': {
      return node.children.some((child) => child.type === '*') ? 'Y*' : 'Y';
    }
    case 'jsx_expression': {
      return node.namedChildren.some((child) => child.type !== 'comment') ? 'JExpr' : undefined;
    }
    default: {
      return;
    }
  }
}

function addSpecialSignature(signature, node) {
  switch (node.type) {
    case 'for_in_statement': {
      const operator =
        node.childForFieldName('operator') ?? node.childForFieldName('header')?.childForFieldName('operator');
      signature.push(`${operator?.type === 'of' ? 'ForOf' : 'ForIn'}@${node.startIndex}`);
      break;
    }
    case 'export_statement': {
      signature.push(`ExpD@${node.children.find((child) => child.type === 'export').startIndex}`);
      break;
    }
    case 'method_definition': {
      if (node.parent.type !== 'object')
        signature.push(
          `Meth@${node.children.find((child) => child.type !== 'decorator' && !child.isExtra).startIndex}`
        );
      break;
    }
    case 'object_assignment_pattern': {
      signature.push(`Prop@${node.startIndex}-${node.endIndex}`, `A=@${node.startIndex}-${node.endIndex}`);
      break;
    }
    case 'spread_element': {
      if (node.parent.type !== 'jsx_expression') signature.push(`...@${node.startIndex}`);
      break;
    }
  }
}

function isJsxName(node) {
  let parent = node.parent;
  while (parent?.type === 'member_expression') parent = parent.parent;
  return !!parent && /^jsx_(opening|closing|self_closing)_element$/.test(parent.type);
}

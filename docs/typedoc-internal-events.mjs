// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// A TypeDoc plugin: leaves the events tagged @internal out of addEventListener's and removeEventListener's `type`.
// excludeInternal removes an event map's members, but where TypeDoc resolves `keyof` the map (the type parameter of an
// inherited addEventListener) it would still list their names.

import ts from 'typescript';
import { Converter, ReflectionKind } from 'typedoc';

const LISTENER_METHODS = new Set(['addEventListener', 'removeEventListener']);

/** Event map interface name → the names of its members tagged @internal, read from the declarations */
function internalEvents(programs) {
  const events = new Map();
  for (const program of programs) {
    for (const file of program.getSourceFiles()) {
      if (program.isSourceFileDefaultLibrary(file) || file.fileName.includes('/node_modules/')) continue;
      const visit = (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('EventMap')) {
          for (const member of node.members) {
            if (!ts.isPropertySignature(member) || !member.name) continue;
            if (!ts.getJSDocTags(member).some((tag) => tag.tagName.text === 'internal')) continue;
            const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
            if (name === null) continue;
            if (!events.has(node.name.text)) events.set(node.name.text, new Set());
            events.get(node.name.text).add(name);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return events;
}

/** The names of the event maps a type refers to, e.g. `InputEventMap` in `EventHandler<Input, InputEventMap[K]>` */
function referencedMaps(type, events, found = new Set()) {
  if (!type || typeof type !== 'object') return found;
  if (type.type === 'reference' && events.has(type.name)) found.add(type.name);
  for (const key of ['typeArguments', 'types', 'elements']) {
    for (const inner of type[key] ?? []) referencedMaps(inner, events, found);
  }
  for (const key of ['objectType', 'indexType', 'elementType', 'target', 'checkType', 'extendsType', 'trueType', 'falseType']) {
    referencedMaps(type[key], events, found);
  }
  return found;
}

export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const events = internalEvents(context.programs);
    if (events.size === 0) return;
    for (const method of context.project.getReflectionsByKind(ReflectionKind.Method)) {
      if (!LISTENER_METHODS.has(method.name)) continue;
      for (const signature of method.signatures ?? []) {
        const hidden = new Set();
        for (const parameter of signature.parameters ?? []) {
          for (const map of referencedMaps(parameter.type, events)) {
            for (const name of events.get(map)) hidden.add(name);
          }
        }
        if (hidden.size === 0) continue;
        for (const parameter of signature.typeParameters ?? []) {
          const constraint = parameter.type;
          if (constraint?.type !== 'union') continue;
          constraint.types = constraint.types.filter((type) => !(type.type === 'literal' && hidden.has(type.value)));
        }
      }
    }
  });
}

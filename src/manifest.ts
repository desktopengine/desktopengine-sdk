// DesktopEngine SDK
// Copyright © 2024 senpng. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';

// The rules of the app, which refuses packages it can't decode.
export const TYPES = ['wallpaper', 'widget', 'pet'] as const;
export const WIDGET_SIZES = ['small', 'medium', 'large'] as const;
export const PERMISSIONS = ['network', 'files', 'audio', 'system-info', 'now-playing', 'window-positions'] as const;
export const PARAMETER_TYPES = ['toggle', 'number', 'text', 'color', 'choice'] as const;
export const MANIFEST_FILE = 'manifest.json';
export const ENTRY_FILE = 'index.js';
/** `DesktopEngine.apiVersion` these types and rules describe. */
export const API_VERSION = 9;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
/** BCP 47 language tag, e.g. en, zh-Hans, pt-BR */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export type ContentType = (typeof TYPES)[number];
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export type ParameterType = (typeof PARAMETER_TYPES)[number];
/** A value the app can decode as `JSONValue`. */
export type Scalar = boolean | number | string | null;

/**
 * Text shown in the app: a string, or translations keyed by language, e.g. `{ "en": "Clock", "zh-Hans": "时钟" }`.
 * The app picks the one for the user's preferred languages, English when none of them match.
 */
export type LocalizedString = string | Record<string, string>;

export interface ParameterOption {
  value: Scalar;
  title: LocalizedString;
}

export interface Parameter {
  key: string;
  title: LocalizedString;
  type: ParameterType;
  default?: Scalar;
  options?: ParameterOption[];
  min?: number;
  max?: number;
  step?: number;
}

/** `manifest.json`, the same as `ContentManifest` in the app. */
export interface Manifest {
  id: string;
  name: LocalizedString;
  type: ContentType;
  version: string;
  apiVersion?: number;
  author?: string;
  description?: LocalizedString;
  icon?: string;
  preview?: string;
  widget?: { sizes: WidgetSize[] };
  permissions?: string[];
  parameters?: Parameter[];
}

export interface Issues {
  errors: string[];
  warnings: string[];
}

type JSONObject = Record<string, unknown>;

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function isScalar(value: unknown): value is Scalar {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

function isPlainObject(value: unknown): value is JSONObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The English text of a string or translations (the CLI speaks English), otherwise the first translation, like the app falls back. */
export function englishText(value: LocalizedString): string {
  if (typeof value === 'string') return value;
  return value.en ?? Object.values(value)[0] ?? '';
}

/**
 * Checks a string or `{ language: string }` translations, adds errors and warnings mentioning `where`.
 * @returns whether it's usable
 */
function validateLocalizedString(value: unknown, where: string, errors: string[], warnings: string[]): boolean {
  if (typeof value === 'string') {
    if (value.trim() === '') {
      errors.push(`"${where}" must not be empty`);
      return false;
    }
    return true;
  }
  if (!isPlainObject(value)) {
    errors.push(`"${where}" must be a string or translations like { "en": "…", "zh-Hans": "…" }`);
    return false;
  }
  const languages = Object.keys(value);
  if (languages.length === 0) {
    errors.push(`"${where}" has no translations`);
    return false;
  }
  let usable = true;
  for (const language of languages) {
    if (typeof value[language] !== 'string' || (value[language] as string).trim() === '') {
      errors.push(`"${where}.${language}" must be a non-empty string`);
      usable = false;
    }
    if (!LANGUAGE_PATTERN.test(language)) {
      warnings.push(`"${where}": "${language}" isn't a language code like en, zh-Hans or pt-BR, the app never picks it`);
    }
  }
  if (!languages.includes('en')) {
    warnings.push(`"${where}" has no "en" translation, used when none of the user's languages match`);
  }
  return usable;
}

/** A relative path that stays inside the package. */
function isInsidePackage(relativePath: unknown): relativePath is string {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    return false;
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  return !normalized.startsWith('../') && normalized !== '..';
}

/**
 * Checks a parsed manifest.
 * @param options also checks referenced files when `packageDir` is given
 */
export function validateManifest(manifest: unknown, options: { packageDir?: string } = {}): Issues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { packageDir } = options;

  if (!isPlainObject(manifest)) {
    return { errors: ['manifest.json must be a JSON object'], warnings };
  }

  const requireString = (key: string): boolean => {
    const value = manifest[key];
    if (value === undefined) {
      errors.push(`"${key}" is missing`);
      return false;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`"${key}" must be a non-empty string`);
      return false;
    }
    return true;
  };

  if (requireString('id') && !ID_PATTERN.test(manifest.id as string)) {
    errors.push(`"id" can only contain letters, digits, dots and hyphens and must start with a letter or a digit, e.g. com.example.clock (it is "${manifest.id}")`);
  }
  if (manifest.name === undefined) {
    errors.push('"name" is missing');
  } else {
    validateLocalizedString(manifest.name, 'name', errors, warnings);
  }
  if (requireString('version') && !/^\d+(\.\d+){0,2}([-+].+)?$/.test(manifest.version as string)) {
    warnings.push(`"version" should be a semantic version, e.g. 1.0.0 (it is "${manifest.version}")`);
  }

  const { apiVersion } = manifest;
  if (apiVersion !== undefined) {
    if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1) {
      errors.push(`"apiVersion" must be a positive integer (it is ${JSON.stringify(apiVersion)})`);
    } else if (apiVersion > API_VERSION) {
      warnings.push(`"apiVersion" ${apiVersion} is newer than ${API_VERSION}, the one this SDK supports: update the SDK. Older versions of the app refuse to import the package`);
    }
  }

  if (manifest.type === undefined) {
    errors.push('"type" is missing');
  } else if (!isOneOf(TYPES, manifest.type)) {
    errors.push(`"type" must be one of ${TYPES.join(', ')} (it is ${JSON.stringify(manifest.type)})`);
  }

  if (manifest.author !== undefined && typeof manifest.author !== 'string') {
    errors.push('"author" must be a string');
  }
  if (manifest.description !== undefined) {
    validateLocalizedString(manifest.description, 'description', errors, warnings);
  }

  for (const key of ['icon', 'preview']) {
    const value = manifest[key];
    if (value === undefined) continue;
    if (!isInsidePackage(value)) {
      errors.push(`"${key}" must be a relative path inside the package`);
    } else if (packageDir && !fs.existsSync(path.join(packageDir, value))) {
      errors.push(`"${key}" points to a file that doesn't exist: ${value}`);
    }
  }
  if (manifest.preview === undefined && manifest.icon === undefined) {
    warnings.push('No "preview" or "icon": the library shows a default icon');
  }

  const { widget } = manifest;
  if (widget !== undefined) {
    if (!isPlainObject(widget)) {
      errors.push('"widget" must be an object');
    } else if (!Array.isArray(widget.sizes)) {
      errors.push('"widget.sizes" must be an array');
    } else {
      widget.sizes.forEach((size: unknown, index) => {
        if (!isOneOf(WIDGET_SIZES, size)) {
          errors.push(`"widget.sizes[${index}]" must be one of ${WIDGET_SIZES.join(', ')}`);
        }
      });
      if (widget.sizes.length === 0) {
        warnings.push('"widget.sizes" is empty, the app uses small');
      }
    }
    if (manifest.type !== 'widget') {
      warnings.push('Only widgets (type widget) use "widget"');
    }
  } else if (manifest.type === 'widget') {
    warnings.push('The widget declares no "widget.sizes", the app uses small');
  }

  const { permissions } = manifest;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      errors.push('"permissions" must be an array');
    } else {
      permissions.forEach((permission: unknown, index) => {
        if (typeof permission !== 'string') {
          errors.push(`"permissions[${index}]" must be a string`);
        } else if (!isOneOf(PERMISSIONS, permission)) {
          warnings.push(`Unknown permission "${permission}", the known ones are ${PERMISSIONS.join(', ')}`);
        }
      });
    }
  }

  const { parameters } = manifest;
  if (parameters !== undefined) {
    if (!Array.isArray(parameters)) {
      errors.push('"parameters" must be an array');
    } else {
      const keys = new Set<string>();
      parameters.forEach((parameter: unknown, index) => {
        validateParameter(parameter, `parameters[${index}]`, keys, errors, warnings);
      });
    }
  }

  const known = new Set(['id', 'name', 'type', 'version', 'author', 'description', 'icon', 'preview', 'widget', 'permissions', 'parameters', 'apiVersion', '$schema']);
  Object.keys(manifest)
    .filter((key) => !known.has(key))
    .forEach((key) => warnings.push(`The app ignores the unknown field "${key}"`));

  return { errors, warnings };
}

function validateParameter(parameter: unknown, where: string, keys: Set<string>, errors: string[], warnings: string[]): void {
  if (!isPlainObject(parameter)) {
    errors.push(`"${where}" must be an object`);
    return;
  }
  if (typeof parameter.key !== 'string' || parameter.key === '') {
    errors.push(`"${where}.key" must be a non-empty string`);
  } else if (keys.has(parameter.key)) {
    errors.push(`"${where}.key" repeats an earlier parameter: ${parameter.key}`);
  } else {
    keys.add(parameter.key);
  }
  if (parameter.title === undefined) {
    errors.push(`"${where}.title" is missing`);
  } else {
    validateLocalizedString(parameter.title, `${where}.title`, errors, warnings);
  }
  if (!isOneOf(PARAMETER_TYPES, parameter.type)) {
    errors.push(`"${where}.type" must be one of ${PARAMETER_TYPES.join(', ')}`);
    return;
  }
  for (const key of ['min', 'max', 'step']) {
    if (parameter[key] !== undefined && typeof parameter[key] !== 'number') {
      errors.push(`"${where}.${key}" must be a number`);
    }
  }
  if (typeof parameter.min === 'number' && typeof parameter.max === 'number' && parameter.min >= parameter.max) {
    errors.push(`"${where}": min must be less than max`);
  }

  const value = parameter.default;
  if (value !== undefined && !isScalar(value)) {
    errors.push(`"${where}.default" can only be a boolean, a number, a string or null`);
    return;
  }

  switch (parameter.type) {
    case 'toggle':
      if (value !== undefined && typeof value !== 'boolean') errors.push(`"${where}.default" must be a boolean`);
      break;
    case 'number':
      if (value !== undefined && typeof value !== 'number') errors.push(`"${where}.default" must be a number`);
      break;
    case 'text':
      if (value !== undefined && typeof value !== 'string') errors.push(`"${where}.default" must be a string`);
      break;
    case 'color':
      if (value !== undefined && (typeof value !== 'string' || !COLOR_PATTERN.test(value))) {
        errors.push(`"${where}.default" must be a color like #RRGGBB`);
      }
      break;
    case 'choice': {
      const { options } = parameter;
      if (!Array.isArray(options) || options.length === 0) {
        errors.push(`"${where}.options" must be a non-empty array`);
        break;
      }
      options.forEach((option: unknown, index) => {
        if (!isPlainObject(option) || !isScalar(option.value) || option.title === undefined) {
          errors.push(`"${where}.options[${index}]" must have a value (a boolean, a number, a string or null) and a title`);
        } else {
          validateLocalizedString(option.title, `${where}.options[${index}].title`, errors, warnings);
        }
      });
      if (value !== undefined && !options.some((option: unknown) => isPlainObject(option) && option.value === value)) {
        errors.push(`"${where}.default" must be one of the values in options`);
      }
      break;
    }
  }
}

export interface PackageValidation extends Issues {
  /** `null` when manifest.json is missing or isn't JSON; otherwise as parsed, check `errors` before trusting it. */
  manifest: Manifest | null;
}

/** Reads and checks the package in `packageDir`. */
export function validatePackage(packageDir: string): PackageValidation {
  const manifestPath = path.join(packageDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, errors: [`Can't find ${MANIFEST_FILE}`], warnings: [] };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { manifest: null, errors: [`${MANIFEST_FILE} isn't valid JSON: ${(error as Error).message}`], warnings: [] };
  }

  const result = validateManifest(manifest, { packageDir });
  if (!fs.existsSync(path.join(packageDir, ENTRY_FILE))) {
    result.errors.push(`Can't find the entry file ${ENTRY_FILE}`);
  }
  return { manifest: manifest as Manifest, ...result };
}

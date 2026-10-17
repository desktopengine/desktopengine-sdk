// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

import fs from 'node:fs';
import path from 'node:path';

// The rules of the app, which refuses packages it can't decode.
export const TYPES = ['wallpaper', 'widget', 'companion'] as const;
/** Old names of types, still accepted: apps with API 1 know companions only as `pet`. */
export const TYPE_ALIASES: Readonly<Record<string, ContentType>> = { pet: 'companion' };
/** The API version that introduced each type's current name, for types newer than API 1 */
export const TYPE_API_VERSIONS: Readonly<Partial<Record<ContentType, number>>> = { companion: 2 };
/** The preset widget sizes, as in WidgetKit; a manifest can also declare sizes of its own (API 8) */
export const WIDGET_SIZES = ['small', 'medium', 'large'] as const;
/** The presets' points */
export const WIDGET_SIZE_POINTS: Readonly<Record<WidgetSize, { width: number; height: number }>> = {
  small: { width: 164, height: 164 },
  medium: { width: 344, height: 164 },
  large: { width: 344, height: 344 },
};
/** Who may change a widget's size: the user by its edges, the content by its window's style */
export const WIDGET_RESIZERS = ['user', 'content'] as const;
/** The API version of custom widget sizes and `widget.resize` */
export const WIDGET_SIZING_API_VERSION = 8;
/** The smallest width and height of a widget, in points */
export const MIN_WIDGET_EDGE = 32;
/** The free area of a small display (1280×800 without the menu bar): a bigger widget is scaled down to fit there */
export const SMALL_DISPLAY_AREA = { width: 1280, height: 776 } as const;
/** A custom size's id: lowercase letters, digits and hyphens */
const WIDGET_SIZE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const PERMISSIONS = ['network', 'audio', 'system-info', 'mouse', 'key-activity', 'system-audio', 'window-positions', 'user-files'] as const;
/** The API version that introduced each permission's API, for permissions newer than API 1 */
export const PERMISSION_API_VERSIONS: Readonly<Partial<Record<Permission, number>>> = { mouse: 3, 'key-activity': 3, 'system-audio': 6, 'window-positions': 6, 'user-files': 8 };
/** Permissions content doesn't get: declaring one is a warning */
export const RESERVED_PERMISSIONS: readonly Permission[] = ['key-activity', 'user-files'];
/** The id prefix the store reserves */
const OFFICIAL_ID_PREFIX = 'app.desktopengine.official.';
export const PARAMETER_TYPES = ['toggle', 'number', 'text', 'color', 'choice'] as const;
export const MANIFEST_FILE = 'manifest.json';
export const ENTRY_FILE = 'index.js';
/** `DesktopEngine.apiVersion` these types and rules describe. */
export const API_VERSION = 8;
/** The most domains `network.domains` may list */
export const MAX_NETWORK_DOMAINS = 32;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
/** BCP 47 language tag, e.g. en, zh-Hans, pt-BR */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export type ContentType = (typeof TYPES)[number];
export type Permission = (typeof PERMISSIONS)[number];
/** A preset widget size */
export type WidgetSize = (typeof WIDGET_SIZES)[number];
/** The id of a size in `widget.sizes`: a preset, or a custom size's `id` (API 8) */
export type WidgetSizeId = WidgetSize | (string & {});
export type WidgetResizer = (typeof WIDGET_RESIZERS)[number];
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

/** When an option is shown: while an earlier `toggle` or `choice` option has one of `values` */
export interface ParameterCondition {
  key: string;
  values: Scalar[];
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
  showWhen?: ParameterCondition;
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
  /** The preview in dark mode, for content that follows the appearance; `preview` is then the one in light mode */
  previewDark?: string;
  widget?: {
    /** Preset names and sizes of its own, the first is the default */
    sizes: (WidgetSize | CustomWidgetSize)[];
    /** Its size can change from the one picked: none, it keeps that size */
    resize?: WidgetResize;
  };
  wallpaper?: {
    span?: boolean;
    /** `false` when it isn't made to be the screen saver: the app doesn't offer it there */
    screenSaver?: boolean;
  };
  permissions?: string[];
  /** With the `network` permission: the only hosts it may reach, `api.example.com` or `*.example.com` */
  network?: { domains: string[] };
  parameters?: Parameter[];
}

/** A widget size of its own, in `widget.sizes` (API 8) */
export interface CustomWidgetSize {
  /** Lowercase letters, digits and hyphens, not a preset's name: `launchOptions.size` gives it */
  id: string;
  /** Points, whole numbers, at least 32 */
  width: number;
  height: number;
  /** Shown in the app's size picker */
  name: LocalizedString;
}

/** `widget.resize` (API 8): who may change the widget's size, and within what */
export interface WidgetResize {
  by: WidgetResizer[];
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** `fixed`: the width and height keep the ratio of the size the user picked */
  aspectRatio?: 'fixed';
}

/** A size in `widget.sizes` as the app offers it: its id (`launchOptions.size`) and points */
export interface DeclaredWidgetSize {
  id: WidgetSizeId;
  width: number;
  height: number;
  name?: LocalizedString;
}

/**
 * The sizes a widget's manifest declares that the app can use, in order: presets and custom sizes, the ones that
 * aren't valid left out; small when there are none.
 */
export function declaredWidgetSizes(manifest: { widget?: { sizes?: unknown } } | null | undefined): DeclaredWidgetSize[] {
  const sizes: DeclaredWidgetSize[] = [];
  const entries = manifest?.widget?.sizes;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const size = readWidgetSize(entry);
    if (size && !sizes.some((other) => other.id === size.id)) sizes.push(size);
  }
  return sizes.length ? sizes : [{ id: 'small', ...WIDGET_SIZE_POINTS.small }];
}

/**
 * Sizes as the app lists them for the user to pick: by area, smallest first, presets and sizes of its own mixed; sizes
 * of the same area keep their order. The default is still the first one the manifest declares.
 */
export function widgetSizesByArea<T extends { width: number; height: number }>(sizes: readonly T[]): T[] {
  return sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height || a.index - b.index)
    .map(({ size }) => size);
}

function readWidgetSize(entry: unknown): DeclaredWidgetSize | null {
  if (isOneOf(WIDGET_SIZES, entry)) return { id: entry, ...WIDGET_SIZE_POINTS[entry] };
  if (!isPlainObject(entry)) return null;
  const { id, width, height, name } = entry;
  if (typeof id !== 'string' || !WIDGET_SIZE_ID_PATTERN.test(id) || isOneOf(WIDGET_SIZES, id)) return null;
  if (!isWidgetEdge(width) || !isWidgetEdge(height)) return null;
  return { id, width, height, name: name as LocalizedString };
}

function isWidgetEdge(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_WIDGET_EDGE;
}

export interface Issues {
  errors: string[];
  warnings: string[];
}

type JSONObject = Record<string, unknown>;

/** The type a manifest's `type` stands for, its old name included; `undefined` for an unknown one. */
export function contentType(value: unknown): ContentType | undefined {
  if (isOneOf(TYPES, value)) return value;
  return typeof value === 'string' && Object.hasOwn(TYPE_ALIASES, value) ? TYPE_ALIASES[value] : undefined;
}

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

/**
 * A host name on the internet, or `*.` and one for its subdomains: no IP address, `localhost` or `.local` name, no
 * scheme, port or path. The same rule as the app's.
 */
export function isValidNetworkDomain(domain: string): boolean {
  const host = domain.toLowerCase();
  const name = host.startsWith('*.') ? host.slice(2) : host;
  if (name.length > 253 || name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return false;
  const labels = name.split('.');
  if (labels.length < 2 || !/[a-z]/.test(labels[labels.length - 1])) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
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
  if (requireString('version') && !/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(manifest.version as string)) {
    warnings.push(`"version" should be a semantic version, e.g. 1.0.0 (it is "${manifest.version}")`);
  }

  const { apiVersion } = manifest;
  if (apiVersion !== undefined) {
    if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1) {
      errors.push(`"apiVersion" must be a positive integer (it is ${JSON.stringify(apiVersion)})`);
    } else if (apiVersion > API_VERSION) {
      warnings.push(`"apiVersion" ${apiVersion} is newer than ${API_VERSION}, the one this SDK supports: update the SDK. The app refuses to import a package that needs a newer API than it has`);
    }
  }

  if (manifest.type === undefined) {
    errors.push('"type" is missing');
  } else if (contentType(manifest.type) === undefined) {
    errors.push(`"type" must be one of ${TYPES.join(', ')} (it is ${JSON.stringify(manifest.type)})`);
  } else if (!isOneOf(TYPES, manifest.type)) {
    const type = contentType(manifest.type)!;
    warnings.push(`"type" ${manifest.type} is the old name of ${type}: apps read it as ${type}. Use "${type}" with "apiVersion": ${TYPE_API_VERSIONS[type] ?? 1} unless the package must also work in apps with an older API`);
  } else {
    const needed = TYPE_API_VERSIONS[manifest.type];
    if (needed !== undefined && !(typeof apiVersion === 'number' && apiVersion >= needed)) {
      const oldName = Object.keys(TYPE_ALIASES).find((name) => TYPE_ALIASES[name] === manifest.type);
      errors.push(`"type" ${manifest.type} needs "apiVersion": ${needed} or later${oldName ? ` (apps with an older API know it as ${oldName})` : ''}`);
    }
  }

  if (manifest.author !== undefined && typeof manifest.author !== 'string') {
    errors.push('"author" must be a string');
  }
  if (manifest.description !== undefined) {
    validateLocalizedString(manifest.description, 'description', errors, warnings);
  }

  for (const key of ['icon', 'preview', 'previewDark']) {
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
  if (manifest.previewDark !== undefined && manifest.preview === undefined) {
    warnings.push('"previewDark" without "preview": light mode shows the icon or a default one');
  }

  const { widget } = manifest;
  if (widget !== undefined) {
    if (!isPlainObject(widget)) {
      errors.push('"widget" must be an object');
    } else {
      validateWidget(widget, apiVersion, errors, warnings);
    }
    if (manifest.type !== 'widget') {
      warnings.push('Only widgets (type widget) use "widget"');
    }
  } else if (manifest.type === 'widget') {
    warnings.push('The widget declares no "widget.sizes", the app uses small');
  }

  const { wallpaper } = manifest;
  if (wallpaper !== undefined) {
    if (!isPlainObject(wallpaper)) {
      errors.push('"wallpaper" must be an object');
    } else {
      for (const key of ['span', 'screenSaver']) {
        if (wallpaper[key] !== undefined && typeof wallpaper[key] !== 'boolean') {
          errors.push(`"wallpaper.${key}" must be true or false`);
        }
      }
    }
    if (manifest.type !== 'wallpaper') {
      warnings.push('Only wallpapers (type wallpaper) use "wallpaper"');
    }
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
          // the permissions content can get: one it never gets isn't suggested
          const known = PERMISSIONS.filter((name) => !RESERVED_PERMISSIONS.includes(name));
          errors.push(`Unknown permission "${permission}", the known ones are ${known.join(', ')}`);
        } else {
          const neverGiven = RESERVED_PERMISSIONS.includes(permission) && !String(manifest.id ?? '').startsWith(OFFICIAL_ID_PREFIX);
          if (neverGiven) {
            warnings.push(`Content doesn't get the "${permission}" permission: remove it from "permissions", the store doesn't take packages that declare it`);
          }
          const needed = PERMISSION_API_VERSIONS[permission];
          // no API version to add for a permission that's never given
          if (needed !== undefined && !neverGiven && !(typeof apiVersion === 'number' && apiVersion >= needed)) {
            warnings.push(`The "${permission}" permission's API is in API ${needed}: add "apiVersion": ${needed}, or check DesktopEngine.apiVersion before using it, apps with an older API don't have it`);
          }
        }
      });
    }
  }

  const { network } = manifest;
  const declaresNetwork = Array.isArray(permissions) && permissions.includes('network');
  let domains: unknown[] = [];
  if (network !== undefined) {
    if (!isPlainObject(network)) {
      errors.push('"network" must be an object');
    } else if (network.domains !== undefined && !Array.isArray(network.domains)) {
      errors.push('"network.domains" must be an array');
    } else {
      domains = (network.domains as unknown[] | undefined) ?? [];
      domains.forEach((domain, index) => {
        if (typeof domain !== 'string' || !isValidNetworkDomain(domain)) {
          errors.push(`"network.domains[${index}]" must be a domain name such as api.example.com or *.example.com, not an address, localhost or a URL (it is ${JSON.stringify(domain)})`);
        }
      });
      if (new Set(domains).size !== domains.length) {
        warnings.push('"network.domains" lists a domain twice');
      }
      if (domains.length > MAX_NETWORK_DOMAINS) {
        errors.push(`"network.domains" can list at most ${MAX_NETWORK_DOMAINS} domains`);
      }
      if (!declaresNetwork && domains.length > 0) {
        warnings.push('"network.domains" has no effect without the "network" permission');
      }
    }
  }
  if (declaresNetwork && domains.length === 0) {
    errors.push('The "network" permission needs "network.domains": the domains it connects to, e.g. { "domains": ["api.example.com"] }. It can reach no others');
  }
  // what the Mac plays could be sent anywhere
  if (declaresNetwork && permissions.includes('system-audio') && !String(manifest.id ?? '').startsWith(OFFICIAL_ID_PREFIX)) {
    errors.push('Content with the "system-audio" permission can\'t have "network" too: remove one of them');
  }

  const { parameters } = manifest;
  if (parameters !== undefined) {
    if (!Array.isArray(parameters)) {
      errors.push('"parameters" must be an array');
    } else {
      const keys = new Set<string>();
      const earlier = new Map<string, Record<string, unknown>>();
      parameters.forEach((parameter: unknown, index) => {
        validateParameter(parameter, `parameters[${index}]`, keys, errors, warnings);
        if (isPlainObject(parameter)) {
          validateCondition(parameter.showWhen, `parameters[${index}].showWhen`, earlier, errors);
          if (typeof parameter.key === 'string' && !earlier.has(parameter.key)) earlier.set(parameter.key, parameter);
        }
      });
    }
  }

  const known = new Set(['id', 'name', 'type', 'version', 'author', 'description', 'icon', 'preview', 'previewDark', 'widget', 'wallpaper', 'permissions', 'network', 'parameters', 'apiVersion', '$schema']);
  Object.keys(manifest)
    .filter((key) => !known.has(key))
    .forEach((key) => warnings.push(`The app ignores the unknown field "${key}"`));

  return { errors, warnings };
}

/**
 * `showWhen` of a parameter: an earlier `toggle` or `choice` parameter (`earlier`, by key) and the values of it that
 * show this one, each one it can take
 */
function validateCondition(condition: unknown, where: string, earlier: Map<string, Record<string, unknown>>, errors: string[]): void {
  if (condition === undefined) return;
  if (!isPlainObject(condition)) {
    errors.push(`"${where}" must be an object with "key" and "values"`);
    return;
  }
  const target = typeof condition.key === 'string' ? earlier.get(condition.key) : undefined;
  if (typeof condition.key !== 'string' || condition.key === '') {
    errors.push(`"${where}.key" must be the key of an earlier parameter`);
    return;
  }
  if (!target) {
    errors.push(`"${where}.key" must be the key of an earlier parameter: ${condition.key} isn't one`);
    return;
  }
  if (target.type !== 'toggle' && target.type !== 'choice') {
    errors.push(`"${where}.key" must be a toggle or a choice: ${condition.key} is a ${String(target.type)}`);
    return;
  }
  const { values } = condition;
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`"${where}.values" must be a non-empty array`);
    return;
  }
  const options = Array.isArray(target.options) ? target.options : [];
  values.forEach((value: unknown, index) => {
    const known = target.type === 'toggle'
      ? typeof value === 'boolean'
      : options.some((option: unknown) => isPlainObject(option) && option.value === value);
    if (!known) {
      errors.push(`"${where}.values[${index}]" must be ${target.type === 'toggle' ? 'true or false' : `one of the values of ${condition.key}'s options`}`);
    }
  });
}

/** Checks `widget`: its sizes and how it may be resized */
function validateWidget(widget: JSONObject, apiVersion: unknown, errors: string[], warnings: string[]): void {
  const sizingAPI = typeof apiVersion === 'number' && apiVersion >= WIDGET_SIZING_API_VERSION;
  const declared: DeclaredWidgetSize[] = [];
  if (!Array.isArray(widget.sizes)) {
    errors.push('"widget.sizes" must be an array');
  } else {
    const ids = new Set<string>();
    widget.sizes.forEach((entry: unknown, index) => {
      const where = `widget.sizes[${index}]`;
      if (typeof entry === 'string') {
        if (!isOneOf(WIDGET_SIZES, entry)) {
          errors.push(`"${where}" must be one of ${WIDGET_SIZES.join(', ')}, or a size of its own like { "id": "wide", "width": 440, "height": 196, "name": "Wide" }`);
        } else if (ids.has(entry)) {
          warnings.push(`"${where}" repeats ${entry}`);
        } else {
          ids.add(entry);
          declared.push({ id: entry, ...WIDGET_SIZE_POINTS[entry] });
        }
        return;
      }
      if (!isPlainObject(entry)) {
        errors.push(`"${where}" must be one of ${WIDGET_SIZES.join(', ')}, or a size of its own like { "id": "wide", "width": 440, "height": 196, "name": "Wide" }`);
        return;
      }
      if (!sizingAPI) {
        errors.push(`"${where}": sizes of its own need "apiVersion": ${WIDGET_SIZING_API_VERSION} or later, apps with an older API can't read them`);
      }
      const { id, width, height } = entry;
      let valid = true;
      if (typeof id !== 'string' || !WIDGET_SIZE_ID_PATTERN.test(id)) {
        errors.push(`"${where}.id" must be lowercase letters, digits and hyphens, at most 64 (it is ${JSON.stringify(id)})`);
        valid = false;
      } else if (isOneOf(WIDGET_SIZES, id)) {
        errors.push(`"${where}.id" ${id} is a preset's name: use "${id}" for the preset, or another id`);
        valid = false;
      } else if (ids.has(id)) {
        errors.push(`"${where}.id" repeats ${id}: each size needs an id of its own`);
        valid = false;
      }
      for (const [key, value] of [['width', width], ['height', height]] as const) {
        if (!isWidgetEdge(value)) {
          errors.push(`"${where}.${key}" must be a whole number of points, at least ${MIN_WIDGET_EDGE} (it is ${JSON.stringify(value)})`);
          valid = false;
        }
      }
      if (entry.name === undefined) {
        errors.push(`"${where}.name" is missing: the app's size picker shows it`);
      } else {
        validateLocalizedString(entry.name, `${where}.name`, errors, warnings);
      }
      for (const key of Object.keys(entry)) {
        if (!['id', 'width', 'height', 'name'].includes(key)) warnings.push(`The app ignores the unknown field "${where}.${key}"`);
      }
      if (valid) {
        ids.add(id as string);
        declared.push({ id: id as string, width: width as number, height: height as number });
      }
    });
    if (widget.sizes.length === 0) {
      warnings.push('"widget.sizes" is empty, the app uses small');
    }
  }

  const { resize } = widget;
  let range: { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number } | null = null;
  if (resize !== undefined) {
    if (!sizingAPI) {
      errors.push(`"widget.resize" needs "apiVersion": ${WIDGET_SIZING_API_VERSION} or later, apps with an older API can't read it`);
    }
    if (!isPlainObject(resize)) {
      errors.push('"widget.resize" must be an object like { "by": ["user"] }');
    } else {
      const { by } = resize;
      if (!Array.isArray(by) || by.length === 0) {
        errors.push(`"widget.resize.by" must list who may resize it: ${WIDGET_RESIZERS.map((name) => `"${name}"`).join(', ')} or both`);
      } else {
        by.forEach((value: unknown, index) => {
          if (!isOneOf(WIDGET_RESIZERS, value)) errors.push(`"widget.resize.by[${index}]" must be one of ${WIDGET_RESIZERS.join(', ')}`);
        });
        if (new Set(by).size !== by.length) warnings.push('"widget.resize.by" lists one twice');
      }
      const limits: Partial<Record<'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight', number>> = {};
      for (const key of ['minWidth', 'minHeight', 'maxWidth', 'maxHeight'] as const) {
        const value = resize[key];
        if (value === undefined) continue;
        if (!isWidgetEdge(value)) {
          errors.push(`"widget.resize.${key}" must be a whole number of points, at least ${MIN_WIDGET_EDGE} (it is ${JSON.stringify(value)})`);
        } else {
          limits[key] = value;
        }
      }
      if (limits.minWidth !== undefined && limits.maxWidth !== undefined && limits.minWidth > limits.maxWidth) {
        errors.push('"widget.resize": minWidth must not be more than maxWidth');
      }
      if (limits.minHeight !== undefined && limits.maxHeight !== undefined && limits.minHeight > limits.maxHeight) {
        errors.push('"widget.resize": minHeight must not be more than maxHeight');
      }
      if (resize.aspectRatio !== undefined && resize.aspectRatio !== 'fixed') {
        errors.push('"widget.resize.aspectRatio" can only be "fixed": the width and height keep the ratio of the size picked');
      }
      for (const key of Object.keys(resize)) {
        if (!['by', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'aspectRatio'].includes(key)) warnings.push(`The app ignores the unknown field "widget.resize.${key}"`);
      }
      range = {
        minWidth: limits.minWidth ?? MIN_WIDGET_EDGE,
        minHeight: limits.minHeight ?? MIN_WIDGET_EDGE,
        maxWidth: limits.maxWidth ?? Infinity,
        maxHeight: limits.maxHeight ?? Infinity,
      };
    }
  }

  for (const size of declared) {
    if (range && (size.width < range.minWidth || size.width > range.maxWidth || size.height < range.minHeight || size.height > range.maxHeight)) {
      warnings.push(`The size ${size.id} (${size.width}×${size.height}) is outside "widget.resize"'s range: the app starts it at the nearest size inside`);
    }
    if (size.width > SMALL_DISPLAY_AREA.width || size.height > SMALL_DISPLAY_AREA.height) {
      warnings.push(`The size ${size.id} (${size.width}×${size.height}) doesn't fit the free area of a small display (${SMALL_DISPLAY_AREA.width}×${SMALL_DISPLAY_AREA.height} points): the app scales it down there`);
    }
  }
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

import global from "./global.js";

const entries = new WeakMap();
const fns = new Set();

export function getEntry(target, key) {
  let targetMap = entries.get(target);
  if (!targetMap) {
    targetMap = new Map();
    entries.set(target, targetMap);
  }

  let entry = targetMap.get(key);

  if (!entry) {
    entry = {
      target,
      key,
      value: undefined,
      lastValue: undefined,
      contexts: new Set(),
      deps: new Set(),
      resolved: false,
      observe: undefined,
    };
    targetMap.set(key, entry);
  }

  return entry;
}

export function getEntries(target) {
  const targetMap = entries.get(target);
  if (targetMap) return [...targetMap.values()];
  return [];
}

function queue(fn) {
  if (!fns.size) {
    global.requestAnimationFrame(function execute() {
      const errors = [];

      for (const fn of fns) {
        try {
          fn();
        } catch (e) {
          errors.push(e);
        }
      }

      fns.clear();

      if (errors.length > 1) throw errors;
      if (errors.length) throw errors[0];
    });
  }

  fns.add(fn);
}

function dispatch(entry) {
  const contexts = new Set();
  const iterator = contexts.values();

  while (entry) {
    entry.resolved = false;
    if (entry.observe) queue(entry.observe);

    for (const context of entry.contexts) {
      contexts.add(context);
    }

    entry = iterator.next().value;
  }
}

let context = null;
const contexts = new Set();
export function get(target, key, getter) {
  const entry = getEntry(target, key);

  if (context) {
    context.deps.add(entry);
    entry.contexts.add(context);
  }

  if (entry.resolved) return entry.value;

  const lastContext = context;

  try {
    if (contexts.has(entry)) {
      throw Error(`Circular get invocation is forbidden: '${key}'`);
    }

    context = entry;
    contexts.add(entry);

    for (const depEntry of entry.deps) {
      depEntry.contexts.delete(entry);
    }
    entry.deps.clear();

    entry.value = getter(target, entry.value);
    entry.resolved = true;

    context = lastContext;

    contexts.delete(entry);
  } catch (e) {
    context = lastContext;
    contexts.delete(entry);

    if (context) {
      context.deps.delete(entry);
      entry.contexts.delete(context);
    }

    throw e;
  }

  return entry.value;
}

export function set(target, key, setter, value) {
  const entry = getEntry(target, key);
  const newValue = setter(target, value, entry.value);

  if (newValue !== entry.value) {
    entry.value = newValue;
    dispatch(entry);
  }
}

const gc = new Set();
function deleteEntry(entry) {
  if (!gc.size) {
    global.requestAnimationFrame(() => {
      for (const e of gc) {
        if (e.contexts.size === 0) {
          for (const depEntry of e.deps) {
            depEntry.contexts.delete(e);
          }

          const targetMap = entries.get(e.target);
          targetMap.delete(e.key);
        }
      }

      gc.clear();
    });
  }

  gc.add(entry);
}

function invalidateEntry(entry, options) {
  dispatch(entry);

  if (options.clearValue) {
    entry.value = undefined;
    entry.lastValue = undefined;
  }

  if (options.deleteEntry) {
    deleteEntry(entry);
  }
}

export function invalidate(target, key, options = {}) {
  if (contexts.size) {
    throw Error(
      `Invalidating property in chain of get calls is forbidden: '${key}'`,
    );
  }

  const entry = getEntry(target, key);
  invalidateEntry(entry, options);
}

export function invalidateAll(target, options = {}) {
  if (contexts.size) {
    throw Error(
      "Invalidating all properties in chain of get calls is forbidden",
    );
  }

  const targetMap = entries.get(target);
  if (targetMap) {
    for (const entry of targetMap.values()) {
      invalidateEntry(entry, options);
    }
  }
}

export function observe(target, key, getter, fn) {
  const entry = getEntry(target, key);

  entry.observe = () => {
    const value = get(target, key, getter);

    if (value !== entry.lastValue) {
      fn(target, value, entry.lastValue);
      entry.lastValue = value;
    }
  };

  queue(entry.observe);

  return () => {
    fns.delete(entry.observe);
    entry.observe = undefined;
  };
}

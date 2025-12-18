// Safe math expression evaluator (no eval)
const MATH_FUNCTIONS = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  sqrt: Math.sqrt,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
  random: Math.random,
  PI: Math.PI,
  E: Math.E
};

// Simple expression tokenizer and evaluator
export function calculate(expression) {
  try {
    // Sanitize input - only allow safe characters
    const sanitized = expression.replace(/\s/g, '');
    if (!/^[0-9+\-*/().,%a-zA-Z]+$/.test(sanitized)) {
      throw new Error('Invalid characters in expression');
    }

    // Replace function names and constants
    let processed = sanitized;
    for (const [name, fn] of Object.entries(MATH_FUNCTIONS)) {
      if (typeof fn === 'number') {
        processed = processed.replace(new RegExp(`\\b${name}\\b`, 'gi'), fn.toString());
      }
    }

    // Use Function constructor with restricted scope (safer than eval)
    const safeEval = new Function(
      ...Object.keys(MATH_FUNCTIONS),
      `"use strict"; return (${processed});`
    );

    const result = safeEval(...Object.values(MATH_FUNCTIONS));

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Invalid result');
    }

    return {
      expression,
      result,
      formatted: Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/\.?0+$/, '')
    };
  } catch (error) {
    return {
      expression,
      error: error.message,
      result: null
    };
  }
}

// Date formatting utilities
const DATE_FORMATS = {
  short: { year: 'numeric', month: '2-digit', day: '2-digit' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  iso: 'iso',
  relative: 'relative'
};

export function formatDate(dateInput, format = 'short') {
  try {
    const date = dateInput ? new Date(dateInput) : new Date();

    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }

    if (format === 'iso') {
      return { input: dateInput, formatted: date.toISOString() };
    }

    if (format === 'relative') {
      const now = new Date();
      const diff = now - date;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      let relative;
      if (days > 0) relative = `${days} day${days > 1 ? 's' : ''} ago`;
      else if (hours > 0) relative = `${hours} hour${hours > 1 ? 's' : ''} ago`;
      else if (minutes > 0) relative = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      else relative = 'just now';

      return { input: dateInput, formatted: relative };
    }

    const formatOptions = DATE_FORMATS[format] || DATE_FORMATS.short;
    return {
      input: dateInput,
      formatted: date.toLocaleDateString('en-US', formatOptions)
    };
  } catch (error) {
    return {
      input: dateInput,
      error: error.message
    };
  }
}

// JSON table formatter
export function formatTable(data) {
  try {
    if (!Array.isArray(data) || data.length === 0) {
      return { error: 'Data must be a non-empty array' };
    }

    // Get all unique keys
    const keys = [...new Set(data.flatMap(row => Object.keys(row)))];

    // Calculate column widths
    const widths = keys.map(key => {
      const values = data.map(row => String(row[key] ?? '').length);
      return Math.max(key.length, ...values);
    });

    // Build table
    const separator = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const headerRow = '| ' + keys.map((k, i) => k.padEnd(widths[i])).join(' | ') + ' |';

    const dataRows = data.map(row =>
      '| ' + keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join(' | ') + ' |'
    );

    const table = [separator, headerRow, separator, ...dataRows, separator].join('\n');

    return {
      columns: keys,
      rows: data.length,
      table
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Unit conversion utilities
const CONVERSIONS = {
  // Length
  'km_to_mi': v => v * 0.621371,
  'mi_to_km': v => v * 1.60934,
  'm_to_ft': v => v * 3.28084,
  'ft_to_m': v => v * 0.3048,

  // Weight
  'kg_to_lb': v => v * 2.20462,
  'lb_to_kg': v => v * 0.453592,

  // Temperature
  'c_to_f': v => (v * 9 / 5) + 32,
  'f_to_c': v => (v - 32) * 5 / 9,

  // Volume
  'l_to_gal': v => v * 0.264172,
  'gal_to_l': v => v * 3.78541
};

export function convert(value, conversion) {
  const fn = CONVERSIONS[conversion.toLowerCase()];
  if (!fn) {
    return {
      error: `Unknown conversion: ${conversion}. Available: ${Object.keys(CONVERSIONS).join(', ')}`
    };
  }

  const result = fn(value);
  return {
    input: value,
    conversion,
    result: Number(result.toFixed(4))
  };
}

import { webSearch } from './search.js';
import { fetchPage } from './fetch.js';
import { calculate, formatDate, formatTable } from './utils.js';

// Tool registry
const TOOLS = {
  web_search: async (args) => await webSearch(args.query),
  fetch_page: async (args) => await fetchPage(args.url),
  calculate: (args) => calculate(args.expression),
  format_date: (args) => formatDate(args.date, args.format),
  format_table: (args) => formatTable(args.data)
};

// Execute tool calls from LLM
export async function executeTools(toolCalls) {
  const results = [];

  for (const call of toolCalls) {
    const toolName = call.function.name;
    const toolFn = TOOLS[toolName];

    if (!toolFn) {
      results.push({
        id: call.id,
        name: toolName,
        result: { error: `Unknown tool: ${toolName}` }
      });
      continue;
    }

    try {
      const args = JSON.parse(call.function.arguments);
      const result = await toolFn(args);
      results.push({
        id: call.id,
        name: toolName,
        result
      });
    } catch (error) {
      results.push({
        id: call.id,
        name: toolName,
        result: { error: error.message }
      });
    }
  }

  return results;
}

export { TOOLS };

# GenUI Chat - Interactive AI Sandbox

A Claude Artifact / ChatGPT Canvas-style application where LLM generates real, interactive React apps that run immediately in a browser sandbox.

![GenUI Chat](https://via.placeholder.com/800x400/667eea/ffffff?text=GenUI+Chat)

## Features

- **Interactive App Generation**: LLM creates fully functional React apps with state, inputs, and interactions
- **Sandpack Integration**: Secure browser-based code execution sandbox
- **Auto Error Repair**: Automatically detects and fixes runtime errors
- **Multiple LLM Providers**: OpenAI (GPT-4o) and Google Gemini support
- **Built-in Tools**: Web search, page fetch, calculations
- **Session Persistence**: Conversation history saved in localStorage
- **Glassmorphism UI**: Modern, beautiful interface design

## Supported App Types

The LLM can generate:
- **Calculators**: Tip calculators, BMI calculators, unit converters
- **Charts**: Bar charts, line charts, pie charts (via Chart.js/Recharts)
- **Maps**: Interactive Leaflet maps with markers (no API key required)
- **Forms**: Multi-step forms with validation
- **Timers/Clocks**: Countdown timers, stopwatches
- **Games**: Simple interactive games
- **Data Visualizations**: Tables, lists, dashboards

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- OpenAI or Gemini API key

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd genui-chat2

# Install all dependencies
npm install
npm install --workspace=backend
npm install --workspace=frontend

# Set up environment variables
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys
```

### Configuration

Edit `backend/.env`:

```env
# Server
PORT=3001
FRONTEND_URL=http://localhost:5173

# OpenAI API
OPENAI_API_KEY=sk-your-key-here

# Google Gemini API (optional)
GEMINI_API_KEY=your-gemini-key

# Default provider: openai or gemini
DEFAULT_LLM_PROVIDER=openai
DEFAULT_MODEL=gpt-4o-mini

# Brave Search (optional)
BRAVE_SEARCH_API_KEY=your-brave-key
```

### Running

```bash
# Start both backend and frontend
npm run dev

# Or separately:
npm run dev:backend  # Backend on http://localhost:3001
npm run dev:frontend # Frontend on http://localhost:5173
```

Open http://localhost:5173 in your browser.

## Architecture

```
genui-chat2/
├── backend/                 # Express.js server
│   ├── index.js            # Entry point
│   ├── routes/
│   │   ├── chat.js         # Chat API endpoints
│   │   └── tools.js        # Tools API endpoints
│   ├── services/
│   │   └── llm.js          # LLM provider abstraction
│   └── tools/
│       ├── index.js        # Tool registry
│       ├── search.js       # Web search (DuckDuckGo/Brave)
│       ├── fetch.js        # Page fetching & markdown
│       └── utils.js        # Math, date, formatting
│
├── frontend/               # React + Vite
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── ChatInterface.jsx
│   │   │   ├── MessageList.jsx
│   │   │   ├── SandboxPreview.jsx
│   │   │   ├── ExecutionLog.jsx
│   │   │   ├── ModelSelector.jsx
│   │   │   └── SessionModal.jsx
│   │   ├── context/
│   │   │   ├── ChatContext.jsx
│   │   │   └── SessionContext.jsx
│   │   └── styles/
│   │       └── index.css
│   └── vite.config.js
│
└── package.json            # Workspace root
```

## How the Sandbox Works

### Code Generation

1. User sends a message to the LLM
2. LLM generates structured JSON response:
   ```json
   {
     "type": "sandbox",
     "code": {
       "App.js": "export default function App() { ... }",
       "styles.css": "..."
     }
   }
   ```
3. Frontend extracts code and passes to Sandpack
4. Sandpack renders the app in an isolated iframe

### Available Libraries in Sandbox

| Library | Version | Purpose |
|---------|---------|---------|
| react | ^18.2.0 | UI framework |
| react-dom | ^18.2.0 | DOM rendering |
| react-leaflet | ^4.2.1 | Map components |
| leaflet | ^1.9.4 | Map engine |
| chart.js | ^4.4.1 | Charts |
| react-chartjs-2 | ^5.2.0 | Chart components |
| recharts | ^2.10.3 | Alternative charts |
| date-fns | ^3.0.6 | Date utilities |

### Error Auto-Repair

1. Sandpack detects runtime error
2. User clicks "Auto-fix" button
3. Error message sent to LLM with context
4. LLM generates corrected code
5. Sandbox updates automatically

## Tools API

### Web Search

```bash
POST /api/tools/search
Content-Type: application/json

{ "query": "react hooks tutorial" }
```

Uses DuckDuckGo HTML scraping (no API key) or Brave Search (if configured).

### Page Fetch

```bash
POST /api/tools/fetch
Content-Type: application/json

{ "url": "https://example.com", "timeout": 8000 }
```

Fetches page and converts to markdown.

### Calculate

```bash
POST /api/tools/calculate
Content-Type: application/json

{ "expression": "sqrt(16) + pow(2, 3)" }
```

Safe math evaluation (no eval).

## Extending Capabilities

### Adding New Libraries to Sandbox

Edit `frontend/src/components/SandboxPreview.jsx`:

```javascript
const SANDBOX_DEPENDENCIES = {
  // ... existing deps
  'new-library': '^1.0.0'
};
```

### Adding New Tools

1. Create tool in `backend/tools/`:
   ```javascript
   export async function myTool(args) {
     // Implementation
     return { result: '...' };
   }
   ```

2. Register in `backend/tools/index.js`:
   ```javascript
   const TOOLS = {
     // ... existing tools
     my_tool: async (args) => await myTool(args.input)
   };
   ```

3. Add to LLM tool definitions in `backend/routes/chat.js`:
   ```javascript
   {
     type: 'function',
     function: {
       name: 'my_tool',
       description: '...',
       parameters: { ... }
     }
   }
   ```

### Adding New LLM Providers

Edit `backend/services/llm.js`:

```javascript
const PROVIDERS = {
  // ... existing providers
  custom: {
    baseUrl: 'https://api.custom.com/v1',
    models: ['model-1', 'model-2'],
    getHeaders: () => ({
      'Authorization': `Bearer ${process.env.CUSTOM_API_KEY}`
    })
  }
};
```

## Security Considerations

- **Sandbox Isolation**: Sandpack runs in iframe with restricted permissions
- **No Filesystem Access**: Generated code cannot access host filesystem
- **API Keys Protected**: All keys stored server-side in .env
- **Safe Math Evaluation**: No use of `eval()` for calculations
- **Input Sanitization**: All user inputs validated before processing

## Example Prompts

Try these in the chat:

1. "Create a tip calculator with bill amount, tip percentage, and number of people"
2. "Build an interactive map showing the top 5 tourist attractions in Tokyo"
3. "Make a bar chart comparing iPhone vs Android market share 2020-2024"
4. "Create a countdown timer to New Year 2025"
5. "Build a simple todo list with add/delete functionality"
6. "Make a BMI calculator with height and weight inputs"
7. "Create a color picker with RGB sliders"

## Troubleshooting

### "API key not configured"
Make sure you've copied `.env.example` to `.env` and added your API keys.

### "Failed to generate valid sandbox code"
The LLM sometimes needs multiple attempts. Try rephrasing your request to be more specific.

### Sandbox shows blank/errors
Check the Execution Log panel for details. Click "Auto-fix" to let the LLM repair errors.

### Maps not rendering
Ensure Leaflet CSS is being loaded. The app imports it via external resources.

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss changes.

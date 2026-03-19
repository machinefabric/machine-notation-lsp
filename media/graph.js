// Detect VS Code theme (dark vs light) from CSS variables
function isDarkTheme() {
    const bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    if (!bg) return true; // default to dark
    // Parse the color — if it's dark, we're in a dark theme
    const div = document.createElement('div');
    div.style.color = bg;
    document.body.appendChild(div);
    const computed = getComputedStyle(div).color;
    document.body.removeChild(div);
    const match = computed.match(/\d+/g);
    if (match) {
        const [r, g, b] = match.map(Number);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.5;
    }
    return true;
}

// Initialize mermaid with theme based on VS Code theme
mermaid.initialize({
    startOnLoad: false,
    theme: isDarkTheme() ? 'dark' : 'default',
    flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
    },
    securityLevel: 'loose',
});

const graphContainer = document.getElementById('graph-container');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const status = document.getElementById('status');

let renderCounter = 0;

async function renderGraph(mermaidCode) {
    renderCounter++;
    const id = `mermaid-graph-${renderCounter}`;

    graphContainer.innerHTML = '';
    errorContainer.classList.remove('visible');

    try {
        const { svg } = await mermaid.render(id, mermaidCode);
        graphContainer.innerHTML = svg;
        status.textContent = 'Graph updated';
    } catch (e) {
        showError('Failed to render graph: ' + e.message);
    }
}

function showError(msg) {
    graphContainer.innerHTML = '';
    errorContainer.classList.add('visible');
    errorMessage.textContent = msg;
    status.textContent = 'Error';
}

// Listen for messages from the extension
window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
        case 'graphData':
            if (message.mermaid) {
                renderGraph(message.mermaid);
            }
            break;

        case 'error':
            showError(message.message || 'Unknown error');
            break;
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    // Mermaid SVGs are responsive via useMaxWidth, no re-render needed
});

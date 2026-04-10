<template>
  <div id="app">
    <router-view/>
  </div>
</template>

<script>
export default {
  name: 'App'
}
</script>

<style>
html {
  --fe-bg: #eceff5;
  --fe-bg-mesh: radial-gradient(1200px 600px at 10% -10%, rgba(37, 99, 235, 0.14), transparent 55%),
    radial-gradient(900px 500px at 95% 0%, rgba(124, 58, 237, 0.1), transparent 50%),
    radial-gradient(700px 400px at 50% 110%, rgba(6, 182, 212, 0.08), transparent 45%);
  --fe-surface: #ffffff;
  --fe-surface-2: #f4f6fb;
  --fe-border: #d5dbe8;
  --fe-text: #0f172a;
  --fe-muted: #64748b;
  --fe-accent: #2563eb;
  --fe-accent-hover: #1d4ed8;
  --fe-accent-soft: #eff6ff;
  --fe-accent-2: #7c3aed;
  --fe-radius: 16px;
  --fe-radius-sm: 10px;
  --fe-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --fe-shadow-md: 0 8px 24px rgba(15, 23, 42, 0.08);
  --fe-shadow-lg: 0 20px 50px rgba(15, 23, 42, 0.1);
  --fe-font-display: 'Outfit', ui-sans-serif, system-ui, sans-serif;
}

html,
body {
  background: var(--fe-bg);
  background-image: var(--fe-bg-mesh);
  background-attachment: fixed;
  margin: 0;
}

#app {
  font-family: 'DM Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: left;
  color: var(--fe-text);
}
</style>

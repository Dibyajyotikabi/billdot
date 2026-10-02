// Applies the saved theme before first paint to avoid a flash.
try {
  const theme = localStorage.getItem('bd-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* storage blocked: follow the system theme */
}

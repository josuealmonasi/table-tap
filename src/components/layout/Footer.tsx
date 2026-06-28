/** Generic site footer, shown on every page. */
export default function Footer() {
  return (
    <footer className="tt-footer">
      <div className="container tt-footer-inner">
        <span className="tt-footer-brand">🍴 TableTap</span>
        <span>© {new Date().getFullYear()} TableTap. All rights reserved.</span>
      </div>
    </footer>
  );
}

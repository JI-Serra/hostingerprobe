export const metadata = {
  title: 'Hostinger Capability Probe',
  robots: { index: false, follow: false }
};

export default function ProbeLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

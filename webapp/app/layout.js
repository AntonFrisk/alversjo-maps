import { Inter } from 'next/font/google';
import './globals.css';
import SessionProviderWrapper from '@/components/SessionProviderWrapper';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata = {
  title: 'Alversjö Map Viewer',
  description: 'Interactive satellite map viewer for Alversjö GeoJSON data',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}

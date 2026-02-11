import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'site.oyme',
  appName: 'Oy',
  webDir: 'dist/client',
  server: {
    hostname: 'oyme.site',
    iosScheme: 'https',
    androidScheme: 'https'
  },
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        apple: true,
        facebook: false,
        twitter: false,
      },
    },
  },
};

export default config;

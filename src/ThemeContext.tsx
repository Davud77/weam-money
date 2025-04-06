// ThemeContext.tsx
import React, { createContext, useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark';

type ThemeContextType = {
  themeMode: ThemeMode;
  bgImage: string;
  setThemeMode: (mode: ThemeMode) => void;
  setBgImage: (image: string) => void;
};

export const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'light',
  bgImage: '',
  setThemeMode: () => {},
  setBgImage: () => {},
});

const BACKGROUNDS = [
  'https://i.pinimg.com/originals/f4/de/4e/f4de4ef22265c7ee2018a5971e58a2b4.jpg',
  'https://ocdn.eu/images/pulscms/YTY7MDA_/91781eff49e27c0bd5e910ad20f5cc4c.jpg',
  'https://s3.vegan.ru/iblock/a3c/shutterstock_593417801.jpg',
  'https://wallpapers.com/images/hd/cute-fox-background-9q2vy6ia5vng8npc.jpg',
  'https://a.l3n.co/i/puv8A.jpg',
  'https://a.l3n.co/i/puSBD.md.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/7/76/Barcode_and_Oslo_Opera_house_seen_from_Ekeberg.JPG',
  'https://i.natgeofe.com/n/c8b67c25-b3e2-4b48-aa4e-41e44b245bdc/shutterstock_528933889.jpg',
  'https://avatars.mds.yandex.net/i?id=4a105edb05a8dd8b33f0fa6cb9995715_l-7762130-images-thumbs&n=13',
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7',
  'https://images.unsplash.com/photo-1505761671935-60b3a7427bad',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c',
  'https://images.unsplash.com/photo-1509223197845-458d87318791',
  'https://images.unsplash.com/photo-1581090700227-4c4d45e1641f',
  'https://images.unsplash.com/photo-1556740738-b6a63e27c4df',
  'https://images.unsplash.com/photo-1519125323398-675f0ddb6308',
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d',
  'https://images.unsplash.com/photo-1523413651479-597eb2da0ad6',
  'https://images.unsplash.com/photo-1486308510493-aa64833634ef',
  'https://images.unsplash.com/photo-1533750349088-cd871a92f312',
];

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [bgImage, setBgImage] = useState(BACKGROUNDS[0]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('themeMode');
    const savedBg = localStorage.getItem('bgImage');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setThemeMode(savedTheme);
    }
    if (savedBg) {
      setBgImage(savedBg);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('themeMode', themeMode);
    localStorage.setItem('bgImage', bgImage);
  }, [themeMode, bgImage]);

  return (
    <ThemeContext.Provider value={{ themeMode, bgImage, setThemeMode, setBgImage }}>
      {children}
    </ThemeContext.Provider>
  );
};

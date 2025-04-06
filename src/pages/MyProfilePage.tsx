import React from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import { SelectChangeEvent } from '@mui/material/Select';
import { useNavigate } from 'react-router-dom';

const THEMES = ['light', 'dark'];

// Подборка городских фонов в высоком качестве
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
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7', // LA night
  'https://images.unsplash.com/photo-1505761671935-60b3a7427bad', // architecture
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c', // city with fog
  'https://images.unsplash.com/photo-1509223197845-458d87318791', // park sunset
  'https://images.unsplash.com/photo-1581090700227-4c4d45e1641f', // modern house
  'https://images.unsplash.com/photo-1556740738-b6a63e27c4df', // interior
  'https://images.unsplash.com/photo-1519125323398-675f0ddb6308', // skyline
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d', // night street
  'https://images.unsplash.com/photo-1523413651479-597eb2da0ad6', // roof view
  'https://images.unsplash.com/photo-1486308510493-aa64833634ef', // forest
  'https://images.unsplash.com/photo-1533750349088-cd871a92f312', // desert road
];

const MyProfilePage: React.FC = () => {
  const navigate = useNavigate();

  const [userName, setUserName] = React.useState('Гость');
  const [themeMode, setThemeMode] = React.useState<'light' | 'dark'>('light');
  const [bgImage, setBgImage] = React.useState(BACKGROUNDS[0]);

  React.useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserName(payload.login || 'user');
    } catch (err) {
      console.warn('Не удалось разобрать JWT', err);
    }

    const savedTheme = localStorage.getItem('themeMode');
    const savedBg = localStorage.getItem('bgImage');
    if (savedTheme && THEMES.includes(savedTheme)) {
      setThemeMode(savedTheme as 'light' | 'dark');
    }
    if (savedBg && BACKGROUNDS.includes(savedBg)) {
      setBgImage(savedBg);
    }
  }, [navigate]);

  const handleChangeTheme = (event: SelectChangeEvent<string>) => {
    const newTheme = event.target.value as 'light' | 'dark';
    setThemeMode(newTheme);
    localStorage.setItem('themeMode', newTheme);
  };

  const handleChangeBg = (event: SelectChangeEvent<string>) => {
    const newBg = event.target.value;
    setBgImage(newBg);
    localStorage.setItem('bgImage', newBg);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const isDark = themeMode === 'dark';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundImage: `url("${bgImage}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed', // делает фон неподвижным
        p: 2
      }}
    >
      <Box
        sx={{
          backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)',
          color: isDark ? '#fff' : '#000',
          borderRadius: 2,
          maxWidth: '1920px', // максимальная ширина
            mx: 'auto',
          mt: 10,
          p: 3
        }}
      >
        <Typography variant="h5" sx={{ mb: 2 }}>
          Мой профиль
        </Typography>
        <Typography sx={{ mb: 2 }}>
          Добро пожаловать, <b>{userName}</b>!
        </Typography>

        <FormControl sx={{ mb: 2, minWidth: 200 }}>
          <InputLabel id="theme-label" sx={{ color: isDark ? '#fff' : undefined }}>
            Тема
          </InputLabel>
          <Select
            labelId="theme-label"
            label="Тема"
            value={themeMode}
            onChange={handleChangeTheme}
            sx={{
              color: isDark ? '#fff' : undefined,
              '.MuiOutlinedInput-notchedOutline': {
                borderColor: isDark ? '#fff' : undefined,
              }
            }}
          >
            {THEMES.map((t) => (
              <MenuItem value={t} key={t}>
                {t === 'light' ? 'Светлая' : 'Тёмная'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ mb: 3, minWidth: 300 }}>
          <InputLabel id="bg-label" sx={{ color: isDark ? '#fff' : undefined }}>
            Фон
          </InputLabel>
          <Select
            labelId="bg-label"
            label="Фон"
            value={bgImage}
            onChange={handleChangeBg}
            sx={{
              color: isDark ? '#fff' : undefined,
              '.MuiOutlinedInput-notchedOutline': {
                borderColor: isDark ? '#fff' : undefined,
              }
            }}
          >
            {BACKGROUNDS.map((url, i) => (
              <MenuItem value={url} key={i}>
                Фон #{i + 1}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={() => navigate('/dashboard')}>
            На дашборд
          </Button>
          <Button variant="contained" color="error" onClick={handleLogout}>
            Выйти
          </Button>
        </Stack>
      </Box>
    </Box>
  );
};

export default MyProfilePage;

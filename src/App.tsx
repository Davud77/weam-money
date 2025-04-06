// App.tsx
import React from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import AppRouter from './routes/AppRouter';
import { ThemeProvider } from './ThemeContext';

type GlobalNotificationsReturn = {
  error: string | null;
  open: boolean;
  showError: (msg: string) => void;
  handleClose: () => void;
};

const useGlobalNotifications = (): GlobalNotificationsReturn => {
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const showError = (msg: string) => {
    setError(msg);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
  };

  return { error, open, showError, handleClose };
};

const App: React.FC = () => {
  const { error, open, showError, handleClose } = useGlobalNotifications();

  return (
    <ThemeProvider>
      <Box sx={{ minHeight: '100vh' }}>
        <AppRouter showError={showError} />
        <Snackbar
          open={open}
          autoHideDuration={4000}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          {error ? (
            <Alert onClose={handleClose} severity="error">
              {error}
            </Alert>
          ) : (
            <></>
          )}
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
};

export default App;

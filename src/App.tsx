// App.tsx
import React from 'react';
import { Box, Snackbar } from '@mui/material';
import MuiAlert, { AlertProps } from '@mui/material/Alert';
import AppRouter from './routes/AppRouter';

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

// Опционально: тот же подход, что в доках MUI, чтобы корректно пробрасывался ref
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

const App: React.FC = () => {
  const { error, open, showError, handleClose } = useGlobalNotifications();

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppRouter showError={showError} />

      {error && (
        <Snackbar
          open={open}
          autoHideDuration={4000}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert onClose={handleClose} severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
        </Snackbar>
      )}
    </Box>
  );
};

export default App;

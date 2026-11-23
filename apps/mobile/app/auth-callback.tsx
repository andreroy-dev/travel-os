import { Redirect } from 'expo-router';

/** Landing route for the Google sign-in redirect (travelos://auth-callback). The session is handled in sign-in. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}

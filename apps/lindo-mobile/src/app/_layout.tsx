import { Stack } from 'expo-router'

export default function RootLayout() {
  // El juego ocupa la pantalla entera: una barra de navegación encima solo le
  // roba alto, y no hay una segunda pantalla a la que volver.
  return <Stack screenOptions={{ headerShown: false }} />
}

import { StyleSheet, Text, View } from 'react-native'

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' }
})

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lindo Mobile</Text>
    </View>
  )
}

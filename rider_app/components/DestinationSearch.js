import { StyleSheet } from "react-native"
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete"

export default function DestinationSearch({ onPlaceSelected, placeholder = "Where to?" }) {
  const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY

  return (
    <GooglePlacesAutocomplete
      placeholder={placeholder}
      fetchDetails={true}
      onPress={(data, details = null) => {
        if (details) {
          onPlaceSelected({
            place_id: data.place_id,
            address: data.description,
            latitude: details.geometry.location.lat,
            longitude: details.geometry.location.lng,
          })
        }
      }}
      query={{
        key: API_KEY,
        language: "en",
        components: "country:ug",
      }}
      styles={{
        container: styles.container,
        textInputContainer: styles.textInputContainer,
        textInput: styles.textInput,
        listView: styles.listView,
        row: styles.row,
        description: styles.description,
        separator: styles.separator,
      }}
      enablePoweredByContainer={false}
      debounce={300}
      minLength={2}
      textInputProps={{
        placeholderTextColor: "#999",
        autoFocus: true,
        returnKeyType: "search",
      }}
      nearbyPlacesAPI="GooglePlacesSearch"
      filterReverseGeocodingByTypes={["locality", "administrative_area_level_3"]}
      listViewDisplayed="auto"
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 0,
  },
  textInputContainer: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 0,
  },
  textInput: {
    backgroundColor: "transparent",
    color: "#000",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    height: 52,
    fontWeight: "500",
  },
  listView: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    maxHeight: 240,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  row: {
    backgroundColor: "#fff",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  description: {
    color: "#000",
    fontSize: 15,
    fontWeight: "500",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
  },
})

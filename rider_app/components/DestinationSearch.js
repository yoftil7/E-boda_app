import React from 'react';
import { StyleSheet } from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

export default function DestinationSearch({ onPlaceSelected, placeholder = "Where to?" }) {
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
          });
        }
      }}
      query={{
        key: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        language: 'en',
      }}
      styles={{
        container: styles.container,
        textInputContainer: styles.textInputContainer,
        textInput: styles.textInput,
        listView: styles.listView,
        row: styles.row,
        description: styles.description,
      }}
      enablePoweredByContainer={false}
      debounce={300}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 0,
  },
  textInputContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  textInput: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  listView: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    marginTop: 8,
  },
  row: {
    backgroundColor: '#2a2a2a',
    padding: 13,
    minHeight: 44,
    flexDirection: 'row',
  },
  description: {
    color: '#fff',
    fontSize: 14,
  },
});

import src.maptiler as maptiler


def main():
    geojson = maptiler.load_geojson()
    print(f"Loaded {len(geojson.get('features', []))} features")

    path = maptiler.save_geojson(geojson)
    print(f"Saved to {path}")



if __name__ == "__main__":
    main()

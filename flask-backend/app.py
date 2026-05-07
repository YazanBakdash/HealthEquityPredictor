from flask import Flask, request, jsonify, send_from_directory
import pickle
import numpy as np

app = Flask(__name__, static_folder='static')

# Load model once at startup
with open('model/rf_model.pkl', 'rb') as f:
    model = pickle.load(f)

FEATURES = [
    'Tree_Canopy', 'Affordable_Housing', 'Parks', 'Transit_Stop',
    'Bike_Miles', 'Wifi_Hotspots', 'School_Density', 'Library_Count',
    'Small_Business', 'Grocery_Store', 'Tract_Area_SqMi', 'Population'
]

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json()

        # Validate all features are present
        missing = [f for f in FEATURES if f not in data]
        if missing:
            return jsonify({'error': f'Missing fields: {missing}'}), 400

        # Build input array in correct feature order
        input_values = [float(data[f]) for f in FEATURES]
        input_array = np.array(input_values).reshape(1, -1)

        prediction = model.predict(input_array)[0]

        return jsonify({
            'adi_score': round(float(prediction), 2),
            'status': 'success'
        })

    except ValueError as e:
        return jsonify({'error': f'Invalid input value: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
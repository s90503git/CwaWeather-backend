require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 修改處：環境部 (MOENV) API 設定
const MOENV_API_BASE_URL = "https://data.moenv.gov.tw/api/v2";
const MOENV_API_KEY = process.env.MOENV_API_KEY; // 請確認 .env 有設定此 KEY

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 取得高雄天氣預報
 * CWA 氣象資料開放平臺 API
 * 使用「一般天氣預報-今明 36 小時天氣預報」資料集
 */
const getKaohsiungWeather = async (req, res) => {
  try {
    // 檢查是否有設定 API Key
    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 修改處：同時發送兩個請求 (天氣預報 + 空氣品質)
    // 1. CWA API - 一般天氣預報（36小時）
    const weatherPromise = axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: "新北市",
        },
      }
    );

    // 2. MOENV API - 空氣品質指標 (AQI)
    // 使用 aqx_p_432 (每小時更新資料)
    let aqiPromise = null;
    if (MOENV_API_KEY) {
      aqiPromise = axios.get(`${MOENV_API_BASE_URL}/aqx_p_432`, {
        params: {
          api_key: MOENV_API_KEY,
          limit: 1000,
          sort: "ImportDate desc",
          format: "JSON",
        },
      });
    }

    // 等待所有請求完成
    const [weatherResponse, aqiResponse] = await Promise.all([
      weatherPromise,
      aqiPromise ? aqiPromise.catch((err) => null) : null, // 容錯處理：如果 AQI 失敗不影響天氣顯示
    ]);

    // 取得天氣資料
    const locationData = weatherResponse.data.records.location[0];

    if (!locationData) {
      return res.status(404).json({
        error: "查無資料",
        message: "無法取得天氣資料",
      });
    }

		// 【修正處】處理空氣品質資料：只傳遞 AQI 數值或 'N/A'
		let airQualityAqi = "N/A"; // 預設值為 'N/A'
		if (aqiResponse && aqiResponse.data && aqiResponse.data.records) {
			// 尋找對應縣市的測站 (這裡以"新北市"為例，優先抓取板橋站，若無則抓該縣市第一筆)
			const records = aqiResponse.data.records;
			const targetCity = locationData.locationName; // "新北市"
			
			const station =
				records.find(
					(site) => site.county === targetCity && site.sitename === "板橋"
				) || records.find((site) => site.county === targetCity);

			if (station && station.aqi) {
				// 只傳遞純 AQI 數值（字串形式），讓前端進行判斷
				airQualityAqi = station.aqi; 
			}
		}
    // 【修正結束】

    // 整理天氣資料
    const weatherData = {
      city: locationData.locationName,
      updateTime: weatherResponse.data.records.datasetDescription,
      forecasts: [],
    };

    // 解析天氣要素
    const weatherElements = locationData.weatherElement;
    const timeCount = weatherElements[0].time.length;

    for (let i = 0; i < timeCount; i++) {
      const forecast = {
        startTime: weatherElements[0].time[i].startTime,
        endTime: weatherElements[0].time[i].endTime,
        weather: "",
        rain: "",
        minTemp: "",
        maxTemp: "",
        comfort: "",
        windSpeed: "",
        humidity: "",
        airQuality: airQualityData, // 修改處：填入處理後的空氣品質資料
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx":
            forecast.weather = value.parameterName;
            break;
          case "PoP":
            forecast.rain = value.parameterName + "%";
            break;
          case "MinT":
            forecast.minTemp = value.parameterName + "°C";
            break;
          case "MaxT":
            forecast.maxTemp = value.parameterName + "°C";
            break;
          case "CI":
            forecast.comfort = value.parameterName;
            break;
          case "WS":
            forecast.windSpeed = value.parameterName;
            break;
          case "RH":
            forecast.humidity = value.parameterName + "%";
            break;
        }
      });

      weatherData.forecasts.push(forecast);
    }

    res.json({
      success: true,
      data: weatherData,
    });
  } catch (error) {
    console.error("取得天氣資料失敗:", error.message);

    if (error.response) {
      // API 回應錯誤
      return res.status(error.response.status).json({
        error: "API 錯誤",
        message: error.response.data.message || "無法取得資料",
        details: error.response.data,
      });
    }

    // 其他錯誤
    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      kaohsiung: "/api/weather/kaohsiung",
      health: "/api/health",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 取得高雄天氣預報
app.get("/api/weather/kaohsiung", getKaohsiungWeather);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器運行已運作`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});
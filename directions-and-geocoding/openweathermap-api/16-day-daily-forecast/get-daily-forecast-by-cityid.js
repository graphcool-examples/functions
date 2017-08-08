'use latest'

require('isomorphic-fetch')

const ACCESS_TOKEN = '__API_KEY__'
const api = 'https://api.openweathermap.org/data/2.5/forecast/daily'
const units = 'metric' //or 'standard', or 'imperial'

module.exports = (event) => {
  const { cityId, count } = event.data

  const endpoint = `${api}?id=${cityId}&cnt=${count}&units=${units}&appid=${ACCESS_TOKEN}`

  return fetch(endpoint)
    .then(response => response.json())
  	.then(data =>
      (data.cod == 200)
        ? {data: data}
        : {error: data}
    )
}

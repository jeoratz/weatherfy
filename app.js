/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/web-api/authorization-guide/#authorization_code_flow
 */

var express = require('express'); // Express web server framework
var request = require('request'); // "Request" library
const fs = require("fs");
const http = require("http");
const https = require("https");
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
const bodyParser = require("body-parser");
var conf = require('./config.json');

const env = process.env.NODE_ENV ? process.env.NODE_ENV : "dev";

var client_id = conf.client_id; // Your client id
var client_secret = conf.client_secret; // Your secret
var redirect_uri = env === "production" ? conf.prod_redirect_uri : conf.dev_redirect_uri; // Your redirect uri
var user_id;
var weather;

var SpotifyWebApi = require('spotify-web-api-node');

// credentials are optional
var spotifyApi = new SpotifyWebApi({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUri: redirect_uri
});

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

function waitForElement(){
  if(typeof weather !== "undefined"){
      //variable exists, do what you want
  }
  else{
      setTimeout(waitForElement, 250);
  }
}

function mapWeatherToSpotify() {
  console.log(weather); 
  var energy = ["valence", "danceability", "energy"];
  var params = {
    min_valence: 0,
    min_danceability: 0,
    min_energy: 0,
    max_valence: 0,
    max_danceability: 0,
    max_energy: 0
  }
  var score = weather.current.is_day === "no" ? 0.25 : 0.75;
  score = weather.current.weather_code >= 300 || weather.current.weather_code === 230 ? score * 0.5 : score;
  score = weather.current.weather_code < 300 && weather.current.weather_code !== 113 && weather.current.weather_code !== 116 ? score * 0.75 : score;

  energy.forEach(feature => { params["min_" + feature] = score - 0.20; params["max_" + feature] = score + 0.20 });
  return params;
}

var stateKey = 'spotify_auth_state';

var app = express();

app.use(express.static(__dirname + '/public'))
   .use(cors())
   .use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/login', function(req, res) {

  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope = 'user-read-private user-read-email playlist-modify-public ' +
  'playlist-modify-private playlist-read-private user-top-read streaming';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/callback', function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        var access_token = body.access_token,
            refresh_token = body.refresh_token;

        spotifyApi.setAccessToken(access_token);

        var options = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        };

        // use the access token to access the Spotify Web API
        request.get(options, function(error, response, body) {
          console.log(body);
          user_id = body.id;

        console.log(user_id);

        });

        // we can also pass the token to the browser to make requests from there
        res.redirect('/#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token
          }));
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

app.post('/get-weather', function(req, res) {
  var options = {
    url: 'http://api.weatherstack.com/current?access_key=' + conf.weather_key + "&query=fetch:ip",
    headers: 'Content-Type: application/json'
  }

  request.get(options, function(error, response, body) {
   weather = JSON.parse(body);
   res.send({ 'weather' : body }) 
  })
});

app.get('/make-playlist', function(req, res) {
  var options = {
    url: 'https://api.spotify.com/v1/users/' + user_id + '/playlists',
    headers: { 'Authorization': 'Bearer ' + spotifyApi.getAccessToken() + ', Content-Type: application/json' },
    body: {
      name: "Weatherfied"
    },
    json: true
  }

  request.post(options, function(error, response, body) {
    console.log(body);
    let playlist_id = body.id;

    var artists = [];

    spotifyApi.getMyTopArtists().then(
      function(data) {
        artists = data.body.items.map(entry => entry.id);
        console.log(artists);
        return artists;
      },
      function(err) {
        console.error(err);
      } 
    ).then(
      function(artists) {
        options = {
          url: 'https://api.spotify.com/v1/recommendations?seed_artists=' + 
          artists.slice(0, 5).toString() + "&" + 
            querystring.stringify(mapWeatherToSpotify()) +'&min_popularity=30&market=US',
          headers: { 'Authorization': 'Bearer ' + spotifyApi.getAccessToken() },
          json: true
        }

        request.get(options, function(error, response, body) {
          console.log(body);
          options = {
            url: 'https://api.spotify.com/v1/playlists/' + playlist_id + '/tracks',
            headers: { 'Authorization': 'Bearer ' + spotifyApi.getAccessToken() + ', Content-Type: application/json' },
            body: {
              uris: body.tracks.map(track => track.uri)
            },
            json: true
          }

        request.post(options, function(error, response, body) {
          console.log(body);
          res.redirect('/#' +
            querystring.stringify({
              playlist_id: playlist_id
            }));
      })})
  });
})});

app.get('/refresh_token', function(req, res) {

  // requesting access token from refresh token
  var refresh_token = req.query.refresh_token;
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token;
      res.send({
        'access_token': access_token
      });
    }
  });
});

if (env === "production") {
  const options = {
    key: fs.readFileSync(conf.keyPath),
    cert: fs.readFileSync(conf.certPath)
  };
  // Listen for HTTPS requests
  https.createServer(options, app).listen(443, () => {
    console.log(`Secure App Listening On: 443`);
  });
  // Redirect HTTP to HTTPS
  http
    .createServer((req, res) => {
      const location = `https://${req.headers.host}${req.url}`;
      console.log(`Redirect to: ${location}`);
      res.writeHead(302, { Location: location });
      res.end();
    })
    .listen(80, () => {
      console.log(`App listening on 80 for HTTPS redirect`);
    });
} else {
  console.log('Listening on 8888');
  app.listen(8888);
}

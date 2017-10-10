// Okta + Box Platform integration


// todo:
// have the widget check for an id token in the URL first to avoid edge-case where
// 	   user1 authenticates and then user2 registers using same browser (browser will still have id token for user1)
// de-couple sending activation email from Okta account creation
// install local token validator
// check nonce for newly created users
// use Okta SDK for reg instead of API

////////////////////////////////////////////////////

var bodyParser = require('body-parser');

var BoxSDK = require('box-node-sdk');

const express = require('express');

var fs = require('fs');

var http = require("https");

var util = require('util');

///////////////////////////////////////////////////

// GET CONFIG SETTINGS

var config = JSON.parse(fs.readFileSync(".env"));

///////////////////////////////////////////////////

// SET UP WEB SERVER
const app = express();

var port = process.env.PORT || 3000;

app.listen(port, function () {
	console.log('App listening on port ' + port + '...');
});

// create application/x-www-form-urlencoded parser
var urlencodedParser = bodyParser.urlencoded({ extended: false });

//////////////////////////////////////////////////

// SET UP BOX SDK

var sdk = new BoxSDK({
	clientID: config.boxAppSettings.clientID,
	clientSecret: config.boxAppSettings.clientSecret,

	appAuth: {
		keyID: config.boxAppSettings.appAuth.publicKeyID,
		privateKey: config.boxAppSettings.appAuth.privateKey,
		passphrase: config.boxAppSettings.appAuth.passphrase
	}
});

//////////////////////////////////////////////////

// HOME PAGE
app.get('/', function (req, res) {
	fs.readFile('html/index.html', (err, data) => {
		if (err) {
			console.log("error reading the index.html file");
		}

		var page = data.toString();

		page = page.replace("{{baseUrl}}", "https://" + config.oktaSettings.oktaOrg);
		page = page.replace("{{clientId}}", config.oktaSettings.clientID);
		page = page.replace("{{redirectUri}}", config.oktaSettings.redirectUri);
		page = page.replace("{{logo}}", config.oktaSettings.logo);

		res.send(page);
	});
});

// REGISTRATION PAGE
app.get('/register', function (req, res) {
	fs.readFile('html/register.html', (err, data) => {
		if (err) {
			console.log("error reading the register.html file");
		}
		res.send(data.toString());
	});
});

// REDIRECT FOR NEWLY REGISTERED USERS
app.get('/redirect', function (req, res) {

	var url = "https://" + config.oktaSettings.oktaOrg + "/oauth2/v1/authorize?";
	url += "response_type=id_token";
	url += "&redirect_uri=" + config.oktaSettings.redirectUri;
	url += "&scope=openid%20profile&state=redirectAfterReg&response_mode=fragment&nonce=somenonce";
	url += "&client_id=" + config.oktaSettings.clientID;

	res.writeHead(302, {
		'Location': url
	});

	res.end();

	console.log ("the url is: " + url);
});

// REGISTRATION FORM HANDLER
// TODO: 	* optimize sequencing between creating Okta user and Box user
//			* wait to send Okta activation email until after Box user is set up

app.post('/evaluateRegForm', urlencodedParser, function (req, res) {

	var firstName = req.body.firstName;
	var lastName = req.body.lastName;
	var email = req.body.email;

	createOktaUser(firstName, lastName, email, (errMsg, oktaUserID) => {
		if (errMsg) {
			// customize the thank you page with first name and email address
			fs.readFile('html/error.html', (err, data) => {
				if (err) {
					console.log("error reading the error.html file!");
					res.send("sorry, error reading the error.html file!");
				}
				else {
					var output = data.toString();
					output = output.replace("{{errMsg}}", errMsg);
					res.send(output);
				}
			});
		}
		else { // SUCCESSFULLY CREATED OKTA USER
			console.log("successfully created an Okta user with id " + oktaUserID);

			// customize the thank you page with first name and email address
			fs.readFile('html/thankYou.html', (err, data) => {
				if (err) {
					console.log("error reading the thankYou.html file");
				}

				var output = data.toString();
				output = output.replace("{{firstName}}", firstName);
				output = output.replace("{{email}}", email);

				res.send(output);

				createBoxUser(firstName, lastName, (errMsg, boxUser) => {

					if (errMsg) {
						console.log("something went wrong trying to create a user in Box.");
					}
					else { // SUCCESSFULLY CREATED BOX USER
						console.log("successfully created a Box user with id: " + boxUser.id);

						updateOktaUser(oktaUserID, boxUser.id, (errMsg, result) => {
							if (errMsg) {
								console.log("error updating the Okta user record: " + errMsg);
							}
							else { // UPDATED OKTA USER RECORD WITH BOX ID
								console.log("Okta user record successfully updated with Box ID.");

								var appUserClient = sdk.getAppAuthClient('user', boxUser.id);

								// UPLOAD SAMPLE TXT FILE TO USER'S BOX ACCOUNT

								var stream = fs.createReadStream('sampleFiles/firstFile.txt');

								var fileName = "Welcome to Box Platform, " + firstName + "!.txt";

								appUserClient.files.uploadFile('0', fileName, stream, function(err, res) {
									if (err) throw err;
									else {
										console.log(res);
									}
								});

								// UPLOAD SAMPLE PPT FILE TO USER'S BOX ACCOUNT

								stream = fs.createReadStream('sampleFiles/boxAndOktaPlatformFlows.pptx');

								fileName = "OktaBoxArchitectureFlows.pptx";

								appUserClient.files.uploadFile('0', fileName, stream, function(err, res) {
									if (err) throw err;
									else {
										console.log(res);
									}
								});
							}
						});
					}
				});
			});
		}
	});
});

// ACCEPT ID TOKEN FROM OKTA, GET AN ACCESS TOKEN FROM BOX
app.post('/boxUI', urlencodedParser, function (req, res) {

	validateIDtoken(req.body.idToken, (errMsg, oktaUser) => {
		if (errMsg) {
			console.log("something went wrong with validating the id token: " + errMsg);
		}
		else {

			console.log("the given name is: " + oktaUser.given_name);

			console.log("the boxID is: " + oktaUser.boxID);

			var appUserClient = sdk.getAppAuthClient('user', oktaUser.boxID);

			console.log('App User Client: ' + util.inspect(appUserClient._session));

			appUserClient._session.getAccessToken().then(function(data) {
				console.log("the access token is: " + data);
				res.send(data);
			});
		}
	});
});

function createOktaUser(firstName, lastName, email, callback) {

	// CREATE THE USER IN OKTA
	// user will receive an activation email
	var options = {
		"method": "POST",
		"hostname": config.oktaSettings.oktaOrg,
		"port": null,
		"path": "/api/v1/users?activate=true",
		"headers": {
			"accept": "application/json",
			"content-type": "application/json",
			"authorization": "SSWS " + config.oktaSettings.apiKey,
			"cache-control": "no-cache"
		}
	};

	var req = http.request(options, function (res) {
		var chunks = [];

		res.on("data", function (chunk) {
			chunks.push(chunk);
		});

		res.on("end", function () {
			var body = Buffer.concat(chunks);
			console.log(body.toString());

			var json = JSON.parse(body);

			if (json.errorCode) {
				var msg;

				// the most common error
				if (json.errorCauses[0].errorSummary == "login: An object with this field already exists in the current organization") {
					msg = "That username already exists in this Okta tenant. Please try another username.";
				}
				else { msg = "Something went wrong with the Okta user registration. Please check the logs."; }

				return callback(msg);
			}
			else {
				return callback(null, json.id);
			}
		});
	});

	req.write(JSON.stringify({ profile: 
		{ firstName: firstName,
			lastName: lastName,
			email: email,
			login: email } }));

	req.end();
}

function createBoxUser(firstName, lastName, callback) {

	var name = firstName + " " + lastName;

	var serviceAccountClient = sdk.getAppAuthClient('enterprise', config.enterpriseID);

	serviceAccountClient.enterprise.addAppUser(name, { "is_platform_access_only": true }, function(err, res) {
		if (err) throw err

		else {
			return callback(null, res);
			console.log(res);
		}
	});
}

// UPDATE THE OKTA USER RECORD WITH THE BOX ID

function updateOktaUser(oktaUserID, boxUserID, callback) {

	var options = {
		"method": "POST",
		"hostname": config.oktaSettings.oktaOrg,
		"port": null,
		"path": "/api/v1/users/" + oktaUserID,
		"headers": {
			"accept": "application/json",
			"content-type": "application/json",
			"authorization": "SSWS " + config.oktaSettings.apiKey,
			"cache-control": "no-cache"
		}
	};

	var req = http.request(options, function (res) {
		var chunks = [];

		res.on("data", function (chunk) {
			chunks.push(chunk);
		});

		res.on("end", function () {
			var body = Buffer.concat(chunks);
			console.log(body.toString());

			var json = JSON.parse(body);

			if (json.errorCode) {
				return callback(json);
			}
			else {
				return callback(null, "success");
			}
		});
	});

	req.write(JSON.stringify({ profile: { boxID: boxUserID } }));

	req.end();
}

function validateIDtoken(id_token, callback) {

	var path = "/oauth2/v1/introspect?token=" + id_token + "&client_id=" + config.oktaSettings.clientID + "&client_secret=" + config.oktaSettings.clientSecret;

	var options = {
		"method": "POST",
		"hostname": config.oktaSettings.oktaOrg,
		"port": null,
		"path": path,
		"headers": {
			"content-type": "application/x-www-form-urlencoded",
			"accept": "application/json",
			"cache-control": "no-cache"
		}
	};

	var req = http.request(options, function (res) {
		var chunks = [];

		res.on("data", function (chunk) {
			chunks.push(chunk);
		});

		res.on("end", function () {
			var body = Buffer.concat(chunks);
			console.log(body.toString());

			var json = JSON.parse(body);

			if (json.errorCode) {
				return callback(body.toString());
			}
			else {
				return callback(null, json);
			}
		});
	});

	req.end();
}
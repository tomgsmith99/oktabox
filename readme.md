Okta + Box Platform integration

This package allows you to easily add Okta as the identity provider for your Box Platform installation.

Using Okta, you can add new users to your Box Platform instance, and those users can then authenticate against Okta and use the Box Content Explorer to manage their files.

The app is written in node.js, dependencies are in the package.json file

Main app is app.js

For configuration, copy the the .env_example file to a file called

.env

and fill in the appropriate values.

Okta prerequisites
* Okta tenant
* API key
* OIDC app

Box prerequisites
* Developer account
/*
 * MyFonts Webfont Build ID 355723, 2011-01-24T08:28:11-0500
 *
 * The fonts listed in this notice are subject to the End User License
 * Agreement(s) entered into by the website owner. All other parties are
 * explicitly restricted from using the Licensed Webfonts(s).
 *
 * You may obtain a valid license at the urls below.
 *
 * Webfont: Humanist 777 Black Condensed
 * Url: http://new.myfonts.com/fonts/bitstream/humanist-777/black-condensed/
 * Foundry: Bitstream
 * Copyright: Copyright 1990-1999 as an unpublished work by Bitstream Inc.  All rights reserved.  Confidential.
 * License: http://www.myfonts.com/viewlicense?1056
 * Licensed pageviews: 10,000/month
 * CSS font-family: Humanist777BT-BlackCondensedB
 * CSS font-weight: normal
 *
 * (c) 2011 Bitstream, Inc
*/



// change this to false if you're having trouble with WOFFs
var woffEnabled = true;
// uncomment this and set it to the path of your webfont directory
//var customPath = "/themes/fonts";

var scripts = document.getElementsByTagName("SCRIPT");
var script = scripts[scripts.length-1].src;

if (!script.match("://") && script.charAt(0) != '/')
	script = "./"+script;

var path = script.replace(/\\/g,'/').replace(/\/[^\/]*\/?$/, '');

// safari 3.1: data-css
// firefox 3.6+: woff
// firefox 3.5+: data-css
// chrome 4+: data-css
// chrome 6+: woff
// IE 5+: eot
// IE 9: woff
// opera 10.1+: data-css
// mobile safari: svg



var browserName, browserVersion, webfontType;

var webfontTypeOverride;

if (/webfont=(woff|ttf|eot)/.test(window.location.search))
{
	webfontTypeOverride = RegExp.$1;

	if (webfontTypeOverride == 'ttf')
		webfontTypeOverride = 'data-css';
}

if (/MSIE (\d+\.\d+)/.test(navigator.userAgent))
{
	browserName = 'MSIE';
	browserVersion = new Number(RegExp.$1);
	if (browserVersion >= 9.0 && woffEnabled)
		webfontType = 'woff';
	else if (browserVersion >= 5.0)
		webfontType = 'eot';
}

else if (/Firefox[\/\s](\d+\.\d+)/.test(navigator.userAgent))
{
	browserName = 'Firefox';
	browserVersion = new Number(RegExp.$1);
	if (browserVersion >= 3.6 && woffEnabled)
		webfontType = 'woff';
	else if (browserVersion >= 3.5)
		webfontType = 'data-css';
}

else if (/Chrome\/(\d+\.\d+)/.test(navigator.userAgent)) // must check before safari
{
	browserName = 'Chrome';
	browserVersion = new Number(RegExp.$1);

	if (browserVersion >= 6.0 && woffEnabled)
		webfontType = 'woff';

	else if (browserVersion >= 4.0)
		webfontType = 'data-css';
}

else if (/Mozilla.*(iPhone|iPad).* OS (\d+)_(\d+).* AppleWebKit.*Safari/.test(navigator.userAgent))
{
        browserName = 'MobileSafari';
        browserVersion = new Number(RegExp.$2) + (new Number(RegExp.$3) / 10)

	if(browserVersion >= 4.2)
		webfontType = 'data-css';

	else
		webfontType = 'svg';
}

else if (/Mozilla.*(iPhone|iPad).*AppleWebKit.*Safari/.test(navigator.userAgent))
{
	browserName = 'MobileSafari';
	webfontType = 'svg';
}

else if (/Safari\/(\d+\.\d+)/.test(navigator.userAgent))
{
	browserName = 'Safari';
	if (/Version\/(\d+\.\d+)/.test(navigator.userAgent))
	{
		browserVersion = new Number(RegExp.$1);
		if (browserVersion >= 3.1)
			webfontType = 'data-css';
	}
}

else if (/Opera\/(\d+\.\d+)/.test(navigator.userAgent))
{
	browserName = 'Opera';
	if (/Version\/(\d+\.\d+)/.test(navigator.userAgent))
	{
		browserVersion = new Number(RegExp.$1);
		if (browserVersion >= 10.1)
			webfontType = 'data-css';
	}
}

if (!webfontType)
{
	// use flash?
}

if (webfontTypeOverride)
	webfontType = webfontTypeOverride;

switch (webfontType)
{
		case 'eot':
		document.write("<style>\n");
				document.write("@font-face {font-family:\"Humanist777BT-BlackCondensedB\";src:url(\"" + path + "/eot/style_1068.eot\");}\n");
				document.write("</style>");
		break;

		case 'woff':
		document.write("<style>\n");
				document.write("@font-face {font-family:\"Humanist777BT-BlackCondensedB\";src:url(\"" + path + "/woff/style_1068.woff\") format(\"woff\");}\n");
				document.write("</style>");
		break;

		case 'data-css':
		document.write("<link rel='stylesheet' type='text/css' href='" + path + "/datacss/humanist.css'>");
		break;

		case 'svg':
		document.write("<style>\n");
				document.write("@font-face {font-family:\"Humanist777BT-BlackCondensedB\";src:url(\"" + path + "/svg/style_1068.svg#Humanist777BT-BlackCondensedB\") format(\"svg\");}\n");
				document.write("</style>");
		break;

	default:
		webfontType = 'default';
		break;
}

//document.write(browserName + ' ' + browserVersion + ': ' + webfontType + ' [' + navigator.userAgent + ']');

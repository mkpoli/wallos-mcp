# Third-party components

## Barlow

`assets/barlow-*.woff2` are subsets of Barlow, served by this Worker so the
connect page makes no request to a font CDN while somebody is typing an API key.
Copyright 2017 The Barlow Project Authors, under the SIL Open Font License 1.1.
The full licence is in `assets/Barlow-OFL.txt`.

Wallos sets its own interface in Barlow, which is why the connect page uses it.

## Wallos

This server talks to [Wallos](https://github.com/ellite/Wallos), which is
GPL-3.0. No Wallos code, stylesheet or translation is included here. The connect
page matches Wallos's palette and proportions, and its interface strings are this
project's own.

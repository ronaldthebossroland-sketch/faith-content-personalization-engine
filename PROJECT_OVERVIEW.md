# Project Overview

## Project name

Faith Content Personalization Engine

## Purpose

Attach a consent-first personalization engine to a Healing School-style app so users can receive more relevant faith-based content from anonymous, approved interest signals.

## Current capability

The app can:

- create anonymous user profiles
- record consent and consent history
- track app activity only after consent
- accept outside-platform signals only from approved ministry sources
- reject unapproved sources
- apply time-decay so older interests fade
- detect broad content personas
- generate local or Gemini-powered profile summaries
- recommend content using interests, preferences, freshness, format, language, and seen-content history
- reset or delete a user profile
- protect admin event and consent views with an API key
- retain data according to `DATA_RETENTION_DAYS`
- persist data in a local SQLite database

## Outside-app interest signals

The system does not inspect other apps or private activity.

Outside-platform interest signals work only through deliberate integration. For example, an official Healing Streams registration page can call the tracking API with `source: "approved_healing_school_campaign"` if that source is listed in `APPROVED_EVENT_SOURCES` and the user has consented to `approved_platform_activity`.

## Data principle

Collect only the activity and interest signals needed for personalization.

Do not collect private identity, passwords, private messages, bank details, contacts, microphone recordings, secret browser history, or hidden activity from other apps.

## Example user flow

1. User opens the app.
2. App shows a clear personalization notice.
3. User accepts selected consent scopes.
4. App creates an anonymous user ID.
5. User searches, watches, reads, saves, shares, or clicks approved content.
6. The app or approved ministry platform sends those events to the profiler API.
7. The profiler builds decay-adjusted interest scores.
8. The recommendation engine returns relevant faith-based content suggestions.
9. User can turn personalization off, reset the profile, or delete the anonymous user.

## Suggested app wording

This app uses your consented content activity and interest signals to personalize your faith-based experience. This may include searches, content views, clicks, saved content, shared content, and engagement from this app or approved ministry platforms only. We do not collect private messages, passwords, bank details, contacts, microphone recordings, secret browser history, unrelated app activity, or hidden activity from other websites. You can turn personalization off or reset your profile.

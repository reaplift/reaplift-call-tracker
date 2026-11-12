"""Generates docs/crm-api/README.md in Callyzer's documentation layout: python3 docs/crm-api/tools/gen_readme.py docs/crm-api/README.md"""
import json, sys

out = []
w = out.append

def table(headers, rows):
    w('| ' + ' | '.join(headers) + ' |')
    w('| ' + ' | '.join('---' for _ in headers) + ' |')
    for r in rows:
        w('| ' + ' | '.join(r) + ' |')
    w('')

def code(lang, text):
    w('```' + lang); w(text.strip('\n')); w('```'); w('')

def js(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False)

# ---------- shared parameters ----------
DATES = [
    ('call_from', 'Conditional', 'Long', 'Call start date-time from, in Unix seconds (UTC). Send together with "call_to".'),
    ('call_to', 'Conditional', 'Long', 'Call start date-time to, in Unix seconds (UTC). Inclusive.'),
    ('synced_from', 'Conditional', 'Long', 'Sync date-time from, in Unix seconds (UTC): when the call reached Callit. Send together with "synced_to".'),
    ('synced_to', 'Conditional', 'Long', 'Sync date-time to, in Unix seconds (UTC). Inclusive.'),
]
TYPES = [('call_types', 'No', 'String Array', 'Valid values are Incoming, Outgoing, Missed and Rejected.')]
DURATION = [
    ('duration_les_than', 'No', 'Long', 'Talk time less than, in seconds.'),
    ('duration_grt_than', 'No', 'Long', 'Talk time greater than, in seconds.'),
]
RINGING = [
    ('ringing_time_les_than', 'No', 'Long', 'Ringing time less than, in seconds.'),
    ('ringing_time_grt_than', 'No', 'Long', 'Ringing time greater than, in seconds.'),
]
EMP = [
    ('emp_numbers', 'No', 'String Array', 'Employee company SIM numbers with country code, e.g. "91-9876500000". "9876500000" and "919876500000" are accepted too.'),
    ('emp_tags', 'No', 'String Array', 'Employee tags. In Callit these are team names.'),
]
EXCL = [('is_exclude_numbers', 'No', 'Boolean', 'Leave out excluded numbers (set by the admin in the panel). Default true.')]
METHOD = [
    ('call_method', 'No', 'String', 'Valid values are PhoneCall and WhatsAppCall. Callit tracks phone calls only, so WhatsAppCall returns no calls.'),
    ('call_mode', 'No', 'String', 'Valid values are Voice and Video. Callit tracks voice calls only, so Video returns no calls.'),
]
CLIENT = [('client_numbers', 'No', 'String Array', 'Client numbers, any format.')]
PAGE = [
    ('page_no', 'No', 'Integer', 'Page number. Default 1.'),
    ('page_size', 'No', 'Integer', 'Records per page, 1 to 100. Default 100.'),
]
HOURS = [
    ('working_hour_from', 'No', 'String', 'Working hours start, HH:mm (24-hour). Counted in whole hours. Without it the day starts at 00:00.'),
    ('working_hour_to', 'No', 'String', 'Working hours end, HH:mm (24-hour). Counted in whole hours. Without it the day ends at 24:00.'),
]

RULES_COMMON = [
    ('"call_from" and "call_to" should be sent together', 'Send both call_from and call_to.'),
    ('"synced_from" and "synced_to" should be sent together', 'Send both synced_from and synced_to.'),
    ('"call_from" should be less than "call_to"', 'call_from must be less than call_to.'),
    ('Date range should be 180 days or less', 'The date range can be at most 180 days.'),
    ('"call_types" should be valid', 'Invalid call_types. Valid call types are Incoming or Outgoing or Missed or Rejected.'),
    ('"emp_numbers" should exist in your company', '`emp_numbers not found: <numbers>.`'),
    ('"emp_tags" should exist in your company', '`emp_tags not found: <tags>.`'),
    ('"call_method" should be valid', 'Invalid call_method. Valid values are PhoneCall or WhatsAppCall.'),
    ('"call_mode" should be valid', 'Invalid call_mode. Valid values are Voice or Video.'),
    ('A number field should be a whole number, 0 or more', '`Invalid value for <field>.`'),
]
RULES_PAGE = [
    ('"page_size" should be between 1 and 100', 'Invalid value. The value should be between 1 to 100.'),
    ('"page_no" should be 1 or more', 'Invalid page_no. The value should be 1 or more.'),
]
RULES_HOURS = [
    ('"working_hour_from" and "working_hour_to" should be HH:mm', 'Invalid working_hour_from. Use HH:mm, 24-hour.'),
    ('"working_hour_from" should be before "working_hour_to"', 'working_hour_from must be before working_hour_to.'),
]
NOTES_COMMON = [
    'Blank or null values are ignored.',
    'Without any dates, today (India time) is used.',
    'Send either the call date pair or the sync date pair. If both are sent, calls must match both.',
    'Greater-than and less-than bounds do not include the value itself.',
    'Excluded numbers are left out unless "is_exclude_numbers" is false.',
]

def codes(rows_extra=()):
    rows = [
        ('200 Ok', 'Request succeeded. `{"result": {}, "message": "Success"}`'),
        ('400 Bad Request', 'A parameter is invalid. `{"result": null, "message": "<Error message>"}`'),
        ('401 Unauthorized', 'The API key is missing, wrong or revoked. `{"result": null, "message": "Invalid API key"}`'),
        ('403 Forbidden', 'Your company\'s Callit account is suspended. `{"result": null, "message": "Your company is suspended"}`'),
        ('429 Too Many Requests', 'More than 5 requests in one second. Retry after the "Retry-After" header (1 second).'),
    ]
    table(['HTTP Status Code', 'Description'], rows)

# ---------- shared response parameters ----------
EMP_RESP = [
    ('emp_name', 'String', 'Employee name'),
    ('emp_code', 'String', 'Employee code'),
    ('emp_country_code', 'String', 'Country code of the employee\'s company SIM'),
    ('emp_number', 'String', 'Employee\'s company SIM number without country code'),
    ('emp_tags', 'String Array', 'Employee tags (Callit team names)'),
]
CALL_RESP = [
    ('id', 'String', 'Unique id of the call log'),
    ('client_name', 'String', 'Contact name saved on the employee\'s phone. "Private number" for a hidden caller. Empty if not saved.'),
    ('client_country_code', 'String', 'Country code of the client number. Empty for numbers outside India.'),
    ('client_number', 'String', 'Client number without country code'),
    ('duration', 'Integer', 'Talk time in seconds'),
    ('call_type', 'String', 'Incoming, Outgoing, Missed or Rejected'),
    ('call_date', 'String', 'Call date in India time, yyyy-mm-dd'),
    ('call_time', 'String', 'Call start time in India time, HH:mm:ss'),
    ('note', 'String', 'Comment added by the employee after the call'),
    ('call_recording_url', 'String', 'Link to the call recording. Valid for 24 hours. null when there is no recording.'),
    ('crm_status', 'String', 'Outcome picked by the employee after the call, e.g. "Interested"'),
    ('reminder_date', 'String', 'Follow-up date in India time, yyyy-mm-dd'),
    ('reminder_time', 'String', 'Follow-up time in India time, HH:mm:ss'),
    ('synced_at', 'String', 'When the call reached Callit, yyyy-mm-dd hh:mm:ss IST'),
    ('modified_at', 'String', 'Last change to the call (e.g. comment added), yyyy-mm-dd hh:mm:ss IST'),
    ('lead_id', 'String', 'Always empty. Leads stay in your CRM.'),
    ('call_method', 'String', 'Always PhoneCall'),
    ('call_mode', 'String', 'Always Voice'),
    ('ringing_time', 'Integer', 'Ringing time in seconds'),
]
LIST_RESP = [
    ('total_records', 'Integer', 'Total number of records for the filter'),
    ('page_no', 'Integer', 'Page number'),
    ('page_size', 'Integer', 'Records per page'),
]
CALL_RESP_NO_CLIENT = [r for r in CALL_RESP if not r[0].startswith('client_')]
FULL_RECORD = [CALL_RESP[0]] + EMP_RESP + CALL_RESP[1:]

SAMPLE_CALL = {
    'id': '1042', 'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000',
    'emp_tags': ['North'], 'client_name': 'Asha Builders', 'client_country_code': '91', 'client_number': '9900011111',
    'duration': 185, 'call_type': 'Outgoing', 'call_date': '2026-11-12', 'call_time': '11:00:00',
    'note': 'Site visit planned', 'call_recording_url': 'https://<storage>/c1/2026/11/1042.m4a?X-Amz-Expires=86400&...',
    'crm_status': 'Interested', 'reminder_date': '2026-11-13', 'reminder_time': '10:00:00',
    'synced_at': '2026-11-12 11:03:40 IST', 'modified_at': '2026-11-12 11:04:10 IST', 'lead_id': '',
    'call_method': 'PhoneCall', 'call_mode': 'Voice', 'ringing_time': 8,
}
CALL_ONLY = {k: v for k, v in SAMPLE_CALL.items() if k not in ('emp_name', 'emp_code', 'emp_country_code', 'emp_number', 'emp_tags')}
SAMPLE_REQ = {'call_from': 1794441600, 'call_to': 1794527999, 'call_types': ['Incoming', 'Outgoing'],
              'emp_numbers': ['91-9876500000'], 'is_exclude_numbers': True, 'page_no': 1, 'page_size': 100}

AGG_RESP = [
    ('total_incoming_calls', 'Integer', 'Total number of incoming calls'),
    ('total_incoming_duration', 'Integer', 'Total incoming talk time in seconds'),
    ('total_outgoing_calls', 'Integer', 'Total number of outgoing calls'),
    ('total_outgoing_duration', 'Integer', 'Total outgoing talk time in seconds'),
    ('total_missed_calls', 'Integer', 'Total number of missed calls'),
    ('total_rejected_calls', 'Integer', 'Total number of rejected calls'),
    ('total_calls', 'Integer', 'Total number of calls'),
    ('total_duration', 'Integer', 'Total talk time in seconds'),
    ('total_never_attended_calls', 'Integer', 'Missed or rejected calls from clients who got no connected call afterwards in the period'),
    ('total_not_pickup_by_clients_calls', 'Integer', 'Unanswered outgoing calls to clients who got no connected call afterwards in the period'),
    ('total_unique_clients', 'Integer', 'Number of different client numbers'),
    ('total_connected_calls', 'Integer', 'Calls answered by the other side with talk time above 0'),
]
TIME_RESP = [
    ('total_working_hours', 'String', 'Sum over employees and days of first call start to last call end, HH:mm:ss (hours can pass 24)'),
    ('total_idle_time', 'String', 'Working hours minus time spent ringing and talking, HH:mm:ss'),
]

def endpoint(title, url, method, params, rules, notes, resp, sample, sample_req=None, content='application/json', extra_md=None):
    w(f'### {title}'); w('')
    w('**URL**'); w(''); w(f'`{url}`'); w('')
    w('**HTTP Method**'); w(''); w(method); w('')
    w('**Content Type**'); w(''); w(content); w('')
    if extra_md: w(extra_md); w('')
    w('#### Request Parameters'); w('')
    if params:
        table(['Param Key', 'Is Mandatory?', 'Type', 'Description'], [(f'`{p}`', m, t, d) for p, m, t, d in params])
    else:
        w('None.'); w('')
    if rules:
        w('#### Rules'); w('')
        table(['Business Rule', 'Error Message'], rules)
        for i, n in enumerate(notes, 1): w(f'{i}. {n}')
        w('')
    w('#### Response Parameters'); w('')
    table(['Param Key', 'Data Type', 'Description'], [(f'`{p}`', t, d) for p, t, d in resp])
    w('#### HTTP Response Codes'); w('')
    codes()
    if sample_req is not None:
        w(f'#### Sample Request of {title.replace("Fetch ", "")}'); w('')
        code('json', js(sample_req))
    w(f'#### Sample Response of {title.replace("Fetch ", "")}'); w('')
    code('json' if not isinstance(sample, str) else '', sample if isinstance(sample, str) else js(sample))

# =================== document ===================
w('# Callit APIs 2.3'); w('')
w('Read your company\'s calls and call reports from your own CRM. Callit APIs follow Callyzer APIs v2.3: the same URLs, request parameters and response parameters. A CRM built for Callyzer needs only a new base URL and API key.'); w('')
w('**Production API Base URL**'); w(''); w('`https://callit.reaplift.com/api/v2.3/`'); w('')
w('Every URL below is relative to this base URL, e.g. `https://callit.reaplift.com/api/v2.3/call-log/history`.'); w('')
w('**Contents**'); w('')
for t in ['API Change Log', 'Differences from Callyzer', 'Rate Limit', 'Get API Access Token', 'Call Log APIs', 'Call Log Stream APIs', 'Employee APIs', 'Webhooks', 'PHP Example']:
    w(f'- [{t}](#{t.lower().replace(" ", "-")})')
w('')

w('## API Change Log'); w('')
w('**Version 2.3 - Nov 12, 2026**'); w('')
table(['Type', 'Description'], [
    ('New', 'Call Log APIs: summary, employee summary, analysis, never attended, not picked up by client, unique clients, hourly analytics, day-wise analytics, call history, call history by ids.'),
    ('New', 'Call Log Stream API: call history report as NDJSON.'),
    ('New', 'Employee API: employee details.'),
    ('New', 'API keys per company, created in the Callit panel.'),
])

w('## Differences from Callyzer'); w('')
table(['Topic', 'Callyzer', 'Callit'], [
    ('Base URL', '`https://api1.callyzer.co/api/v2.3/`', '`https://callit.reaplift.com/api/v2.3/`'),
    ('API key', 'Callyzer dashboard', 'Callit panel, Settings'),
    ('Rate limit', '1 request every 2 seconds', '5 requests a second per API key'),
    ('`call_method`, `call_mode`', 'Mandatory', 'Optional. Phone voice calls only.'),
    ('`emp_tags`', 'Employee tags', 'Callit team names'),
    ('`call_recording_url`', 'Permanent link', 'Valid for 24 hours. Fetch the call again for a new link. Recordings are kept for 12 months.'),
    ('`lead_id`, Lead APIs', 'Available', 'Not available. `lead_id` is always empty.'),
    ('Remove Call Recording API', 'Available', 'Not available yet'),
    ('Webhooks', 'Available', 'Not available yet. Poll Fetch Call History Report with `synced_from`/`synced_to`.'),
    ('Sandbox', 'Available', 'Not available. Use a separate API key and revoke it after testing.'),
])

w('## Rate Limit'); w('')
w('Each API key can make 5 requests per second. Above that the API answers HTTP status 429 Too Many Requests; retry after the time in the "Retry-After" header (1 second).'); w('')

w('## Get API Access Token'); w('')
w('### Prerequisites'); w('')
w('- A Callit admin login for your company.'); w('')
w('### Generate API Token'); w('')
w('1. Log in to the Callit panel at `https://callit.reaplift.com`.')
w('2. Open **Settings** and go to **API keys for your CRM**.')
w('3. Enter a name, e.g. "Our CRM", and click **Create key**.')
w('4. Copy the key. It starts with `rlk_` and is shown only once. If it is lost, revoke it and create a new one.')
w('5. Send it in every request header: `Authorization: Bearer <API key>`.'); w('')
w('Keep the key on your CRM\'s server (e.g. in `.env`). Never use it in a browser or mobile app. A key reads only its own company\'s data. Revoking a key in Settings stops it immediately.'); w('')

w('## Call Log APIs'); w('')

ALL = DATES + TYPES + DURATION + RINGING + EMP + EXCL + METHOD
endpoint('Fetch Summary Report', '/call-log/summary', 'POST', ALL, RULES_COMMON, NOTES_COMMON,
         AGG_RESP[:11] + TIME_RESP + [AGG_RESP[11]],
         {'result': {'total_incoming_calls': 111, 'total_incoming_duration': 11905, 'total_outgoing_calls': 67, 'total_outgoing_duration': 4806,
                     'total_missed_calls': 36, 'total_rejected_calls': 1, 'total_calls': 215, 'total_duration': 17617,
                     'total_never_attended_calls': 16, 'total_not_pickup_by_clients_calls': 8, 'total_unique_clients': 48,
                     'total_working_hours': '100:19:34', 'total_idle_time': '95:23:33', 'total_connected_calls': 139}, 'message': 'Success'},
         sample_req={'call_from': 1794441600, 'call_to': 1794527999})

EMP_AGG = AGG_RESP[:4] + [('total_incoming_connected_calls', 'Integer', 'Answered incoming calls'),
                          ('total_outgoing_connected_calls', 'Integer', 'Answered outgoing calls')] + AGG_RESP[4:]
endpoint('Fetch Employee Summary Report', '/call-log/employee-summary', 'POST', ALL + PAGE, RULES_COMMON + RULES_PAGE,
         NOTES_COMMON + ['Every active employee is listed, including employees with no calls, busiest first.'],
         [('employees', 'JSON Array', 'One entry per employee')] + EMP_RESP + EMP_AGG + TIME_RESP + [
             ('last_call_log', 'JSON Object', 'Latest call of the employee in the period (call fields as in Fetch Call History Report, without employee fields). null if none.'),
             ('avg_duration_per_call', 'String', 'Average talk time per call, HH:mm:ss'),
             ('avg_incoming_duration', 'String', 'Average talk time per incoming call, HH:mm:ss'),
             ('avg_outgoing_duration', 'String', 'Average talk time per outgoing call, HH:mm:ss')] + LIST_RESP,
         {'result': {'employees': [{'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'],
            'total_incoming_calls': 1, 'total_incoming_duration': 60, 'total_outgoing_calls': 2, 'total_outgoing_duration': 185,
            'total_incoming_connected_calls': 1, 'total_outgoing_connected_calls': 1, 'total_missed_calls': 2, 'total_rejected_calls': 0,
            'total_calls': 5, 'total_duration': 245, 'total_never_attended_calls': 1, 'total_not_pickup_by_clients_calls': 1,
            'total_unique_clients': 4, 'total_connected_calls': 2, 'total_working_hours': '05:00:30', 'total_idle_time': '04:55:07',
            'last_call_log': {**CALL_ONLY, 'id': '1046', 'client_name': '', 'client_number': '9900044444', 'duration': 0, 'call_time': '14:00:00', 'note': '', 'call_recording_url': None, 'crm_status': '', 'reminder_date': '', 'reminder_time': '', 'ringing_time': 30},
            'avg_duration_per_call': '00:00:49', 'avg_incoming_duration': '00:01:00', 'avg_outgoing_duration': '00:01:33'}]},
          'message': 'Success', 'total_records': 1, 'page_no': 1, 'page_size': 100},
         sample_req={'call_from': 1794441600, 'call_to': 1794527999, 'page_no': 1, 'page_size': 100})

EMP_REF = 'JSON Object'
endpoint('Fetch Analysis Report', '/call-log/analysis', 'POST', ALL, RULES_COMMON, NOTES_COMMON + ['Each employee object below is null when there are no calls.'], [
    ('average_duration', 'JSON Object', 'Averages'),
    ('average_duration.total_duration', 'Integer', 'Total talk time in seconds'),
    ('average_duration.per_call', 'Integer', 'Average talk time per call in seconds'),
    ('average_duration.total_calls', 'Integer', 'Total number of calls'),
    ('average_duration.per_day', 'Integer', 'Average talk time per day with calls, in seconds'),
    ('average_duration.total_days', 'Integer', 'Number of days with calls'),
    ('average_duration.per_incoming_call', 'Integer', 'Average talk time per incoming call in seconds'),
    ('average_duration.total_incoming_calls', 'Integer', 'Total number of incoming calls'),
    ('average_duration.per_outgoing_call', 'Integer', 'Average talk time per outgoing call in seconds'),
    ('average_duration.total_outgoing_calls', 'Integer', 'Total number of outgoing calls'),
    ('time_analysis.average_working_time', 'String', 'Average working hours per employee per day, HH:mm:ss'),
    ('time_analysis.average_idle_time', 'String', 'Average idle time per employee per day, HH:mm:ss'),
    ('top_dialer', EMP_REF, 'Employee fields and total_outgoing_calls: the employee with the most outgoing calls'),
    ('top_answered', EMP_REF, 'Employee fields and total_incoming_calls: the employee with the most answered incoming calls'),
    ('top_caller', EMP_REF, 'Employee fields and total_calls: the employee with the most calls'),
    ('highest_total_duration', EMP_REF, 'Employee fields, total_calls, total_duration, total_incoming_duration, total_outgoing_duration: the employee with the most talk time'),
    ('longest_duration', EMP_REF, 'Employee fields of the longest call, with the call in call_log'),
    ('longest_duration.call_log', 'JSON Object', 'The longest call (call fields as in Fetch Call History Report)'),
], {'result': {
    'average_duration': {'total_duration': 245, 'per_call': 49, 'total_calls': 5, 'per_day': 245, 'total_days': 1, 'per_incoming_call': 60, 'total_incoming_calls': 1, 'per_outgoing_call': 93, 'total_outgoing_calls': 2},
    'time_analysis': {'average_working_time': '05:00:30', 'average_idle_time': '04:55:07'},
    'top_dialer': {'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'], 'total_outgoing_calls': 2},
    'top_answered': {'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'], 'total_incoming_calls': 1},
    'top_caller': {'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'], 'total_calls': 5},
    'highest_total_duration': {'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'], 'total_calls': 5, 'total_duration': 245, 'total_incoming_duration': 60, 'total_outgoing_duration': 185},
    'longest_duration': {'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'], 'call_log': CALL_ONLY}},
    'message': 'Success'})

GROUP_RESP = EMP_RESP + [r for r in CALL_RESP if r[0].startswith('client_')] + [('call_logs', 'JSON Array', 'Calls of this employee with this client')] + [(f'call_logs[].{p}', t, d) for p, t, d in CALL_RESP_NO_CLIENT] + LIST_RESP
GROUP_SAMPLE = lambda num, typ, ring: {'result': [{'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'],
    'client_name': '', 'client_country_code': '91', 'client_number': num,
    'call_logs': [{k: v for k, v in {**CALL_ONLY, 'id': '1045', 'duration': 0, 'call_type': typ, 'call_time': '13:00:00', 'note': '', 'call_recording_url': None, 'crm_status': '', 'reminder_date': '', 'reminder_time': '', 'ringing_time': ring}.items() if not k.startswith('client_')}]}],
    'message': 'Success', 'total_records': 1, 'page_no': 1, 'page_size': 100}

endpoint('Fetch Never Attended Report', '/call-log/never-attended', 'POST', DATES + RINGING + EMP + EXCL + METHOD + PAGE,
         [r for r in RULES_COMMON if 'call_types' not in r[0]] + RULES_PAGE,
         NOTES_COMMON[:3] + ['A call is never attended when it is missed or rejected and the client got no connected call afterwards in the period.', 'Calls are grouped by employee and client; pages count groups.'],
         GROUP_RESP, GROUP_SAMPLE('9900033333', 'Missed', 15))

endpoint('Fetch Not Pickup By Client Report', '/call-log/not-pickup-by-client', 'POST', DATES + RINGING + EMP + EXCL + METHOD + PAGE,
         [r for r in RULES_COMMON if 'call_types' not in r[0]] + RULES_PAGE,
         NOTES_COMMON[:3] + ['A call is not picked up when it is outgoing, has 0 talk time, and the client got no connected call afterwards in the period.', 'Calls are grouped by employee and client; pages count groups.'],
         GROUP_RESP, GROUP_SAMPLE('9900044444', 'Outgoing', 30))

endpoint('Fetch Unique Clients Report', '/call-log/unique-clients', 'POST', DATES + TYPES + RINGING + EMP + EXCL + METHOD + PAGE, RULES_COMMON + RULES_PAGE,
         NOTES_COMMON[:3] + ['Hidden (private) numbers are not counted as clients.', 'Clients are ordered by their latest call, newest first.'],
         [r for r in CALL_RESP if r[0].startswith('client_')] + [
             ('total_calls', 'Integer', 'Total number of calls with the client'), ('total_duration', 'Integer', 'Total talk time in seconds'),
         ] + [r for r in AGG_RESP if r[0] in ('total_incoming_calls', 'total_incoming_duration', 'total_outgoing_calls', 'total_outgoing_duration', 'total_missed_calls', 'total_rejected_calls', 'total_connected_calls', 'total_never_attended_calls', 'total_not_pickup_by_clients_calls')] + [
             ('last_call_log', 'JSON Object', 'Latest call with the client, with the employee fields (no client fields)')] + LIST_RESP,
         {'result': [{'client_name': '', 'client_country_code': '91', 'client_number': '9900022222', 'total_calls': 2, 'total_duration': 60,
                      'total_incoming_calls': 1, 'total_incoming_duration': 60, 'total_outgoing_calls': 0, 'total_outgoing_duration': 0,
                      'total_missed_calls': 1, 'total_rejected_calls': 0, 'total_connected_calls': 1, 'total_never_attended_calls': 0,
                      'total_not_pickup_by_clients_calls': 0,
                      'last_call_log': {k: v for k, v in {**SAMPLE_CALL, 'id': '1044', 'duration': 60, 'call_type': 'Incoming', 'call_time': '12:00:00', 'note': '', 'call_recording_url': None, 'crm_status': '', 'reminder_date': '', 'reminder_time': '', 'ringing_time': 5}.items() if not k.startswith('client_')}}],
          'message': 'Success', 'total_records': 4, 'page_no': 1, 'page_size': 100})

SLOT_RESP = [('total_calls', 'Integer', 'Total number of calls'), ('total_connected_calls', 'Integer', 'Total connected calls'), ('total_duration', 'Integer', 'Total talk time in seconds'),
             ('daily_average.avg_calls', 'Float', 'Calls per day'), ('daily_average.avg_connected_calls', 'Float', 'Connected calls per day'), ('daily_average.avg_duration', 'Integer', 'Talk time per day in seconds')]
endpoint('Fetch Hourly Analytics Report', '/call-log/hourly-analytics', 'POST', ALL + HOURS + [('exclude_days', 'No', 'String Array', 'Days to leave out. Valid values are Sun, Mon, Tue, Wed, Thu, Fri and Sat.')],
         RULES_COMMON + RULES_HOURS + [('"exclude_days" should be valid', 'Invalid exclude_days. Use Sun, Mon, Tue, Wed, Thu, Fri or Sat.')],
         NOTES_COMMON + ['Hours are India time.', 'Slots: "Before" the working hours, one per hour inside them, "After" them. Without working hours there are 24 one-hour slots.'],
         SLOT_RESP + [('time_slots', 'JSON Array', 'One entry per slot'), ('time_slots[].slot', 'String', 'Slot label, e.g. "10:00 AM - 10:59 AM"'),
                      ('time_slots[].total_calls', 'Integer', 'Calls in the slot'), ('time_slots[].total_duration', 'Integer', 'Talk time in the slot in seconds'),
                      ('time_slots[].total_connected_calls', 'Integer', 'Connected calls in the slot'), ('time_slots[].total_call_perc', 'Float', 'Share of all calls, %'),
                      ('time_slots[].total_duration_perc', 'Float', 'Share of all talk time, %'), ('time_slots[].total_connected_calls_perc', 'Float', 'Share of all connected calls, %')],
         {'result': {'total_calls': 5, 'total_connected_calls': 2, 'total_duration': 245, 'daily_average': {'avg_calls': 5, 'avg_connected_calls': 2, 'avg_duration': 245},
                     'time_slots': [{'slot': 'Before 10:00 AM', 'total_calls': 1, 'total_duration': 0, 'total_connected_calls': 0, 'total_call_perc': 20, 'total_duration_perc': 0, 'total_connected_calls_perc': 0},
                                    {'slot': '10:00 AM - 10:59 AM', 'total_calls': 0, 'total_duration': 0, 'total_connected_calls': 0, 'total_call_perc': 0, 'total_duration_perc': 0, 'total_connected_calls_perc': 0},
                                    {'slot': '11:00 AM - 11:59 AM', 'total_calls': 1, 'total_duration': 185, 'total_connected_calls': 1, 'total_call_perc': 20, 'total_duration_perc': 75.51, 'total_connected_calls_perc': 50},
                                    {'slot': 'After 02:00 PM', 'total_calls': 1, 'total_duration': 0, 'total_connected_calls': 0, 'total_call_perc': 20, 'total_duration_perc': 0, 'total_connected_calls_perc': 0}]},
          'message': 'Success'},
         sample_req={'call_from': 1794441600, 'call_to': 1794527999, 'working_hour_from': '10:00', 'working_hour_to': '14:00', 'exclude_days': ['Sun']})

endpoint('Fetch Day-wise Analytics Report', '/call-log/daywise-analytics', 'POST', ALL + HOURS, RULES_COMMON + RULES_HOURS,
         NOTES_COMMON + ['Dates and hours are India time.', 'Slots work as in Fetch Hourly Analytics Report.'],
         SLOT_RESP + [('total_days_with_no_calls_in_time_slot', 'Integer', 'Sum over slots of days with no calls in the slot'),
                      ('time_slots[].slot', 'String', 'Slot label'), ('time_slots[].days_with_no_calls_in_time_slot', 'Integer', 'Days with no calls in this slot'),
                      ('time_slots[].daily_average', 'JSON Object', 'avg_calls, avg_connected_calls, avg_duration for this slot'),
                      ('time_slots[].day_wise', 'JSON Array', 'One entry per date'), ('time_slots[].day_wise[].date', 'String', 'yyyy-mm-dd'),
                      ('time_slots[].day_wise[].day', 'String', 'Sun to Sat'), ('time_slots[].day_wise[].total_calls', 'Integer', 'Calls'),
                      ('time_slots[].day_wise[].total_duration', 'Integer', 'Talk time in seconds'), ('time_slots[].day_wise[].total_connected_calls', 'Integer', 'Connected calls'),
                      ('time_slots[].day_wise[].total_call_perc', 'Float', 'Share of the slot\'s calls, %'), ('time_slots[].day_wise[].total_duration_perc', 'Float', 'Share of the slot\'s talk time, %'),
                      ('time_slots[].day_wise[].total_connected_calls_perc', 'Float', 'Share of the slot\'s connected calls, %')],
         {'result': {'total_calls': 5, 'total_connected_calls': 2, 'total_duration': 245, 'total_days_with_no_calls_in_time_slot': 4,
                     'daily_average': {'avg_calls': 5, 'avg_connected_calls': 2, 'avg_duration': 245},
                     'time_slots': [{'slot': '09:00 AM - 09:59 AM', 'days_with_no_calls_in_time_slot': 0, 'daily_average': {'avg_calls': 1, 'avg_connected_calls': 0, 'avg_duration': 0},
                                     'day_wise': [{'date': '2026-11-12', 'day': 'Thu', 'total_calls': 1, 'total_duration': 0, 'total_connected_calls': 0, 'total_call_perc': 100, 'total_duration_perc': 0, 'total_connected_calls_perc': 0}]}]},
          'message': 'Success'})

endpoint('Fetch Call History Report', '/call-log/history', 'POST', ALL + CLIENT + PAGE, RULES_COMMON + RULES_PAGE,
         NOTES_COMMON + ['Calls are ordered newest first.', '"note", "crm_status" and "reminder_*" can arrive after the call; "modified_at" changes when they do.', 'Do not store "call_recording_url": it is valid for 24 hours. Use Fetch Call History By Ids for a new link.'],
         FULL_RECORD + LIST_RESP,
         {'result': [SAMPLE_CALL], 'message': 'Success', 'total_records': 1, 'page_no': 1, 'page_size': 100}, sample_req=SAMPLE_REQ)

endpoint('Fetch Call History By Ids', '/call-log/get', 'POST', [('unique_ids', 'Yes', 'String Array', 'Ids of the call logs, 1 to 20.')],
         [('"unique_ids" should have 1 to 20 ids', 'Invalid no of unique ids. Minimum 1 and Maximum 20 ids are allowed.')],
         ['Ids that do not belong to your company are left out.', 'Use it to get a new "call_recording_url".'],
         FULL_RECORD, {'result': [SAMPLE_CALL], 'message': 'Success'}, sample_req={'unique_ids': ['1042', '1043']})

w('## Call Log Stream APIs'); w('')
stream_sample = '\n'.join([json.dumps({'result': SAMPLE_CALL}, ensure_ascii=False), json.dumps({'result': {**SAMPLE_CALL, 'id': '1041'}}, ensure_ascii=False)[:60] + ' ... }}', json.dumps({'type': 'END', 'total_records': 2, 'message': 'Success'})])
endpoint('Fetch Call History Report (Stream)', '/call-log/history/stream', 'POST',
         [('call_from', 'Yes', 'Long', 'Call start date-time from, in Unix seconds (UTC).'), ('call_to', 'Yes', 'Long', 'Call start date-time to, in Unix seconds (UTC). Inclusive.')] + TYPES + DURATION + RINGING + EMP + EXCL + CLIENT + METHOD,
         [('"call_from" and "call_to" are mandatory', 'Send both call_from and call_to.')] + [r for r in RULES_COMMON if 'synced' not in r[0] and 'sent together' not in r[0]],
         ['Send the header "Accept: application/x-ndjson".', 'The response is NDJSON: one {"result": {...}} line per call, newest first, then an END line with total_records. Read until the END line.', 'At most 100,000 calls per request; split longer ranges.', 'No paging.'],
         [('result', 'JSON Object', 'One call (fields as in Fetch Call History Report)'), ('type', 'String', '"END" on the last line'), ('total_records', 'Integer', 'Calls sent, on the END line')],
         stream_sample, content='application/json (request), application/x-ndjson (response)')

w('## Employee APIs'); w('')
endpoint('Fetch Employee Details', '/employee/get', 'GET (POST also accepted)', [
    ('emp_numbers', 'No', 'String Array', 'Employee company SIM numbers, e.g. "91-9876500000". Max 100.'),
    ('emp_tags', 'No', 'String Array', 'Team names. Max 100.'),
    ('emp_name', 'No', 'String', 'Exact employee name, any case.'),
    ('emp_codes', 'No', 'String Array', 'Employee codes. Max 100.'),
] + PAGE, RULES_PAGE, ['With GET, send parameters as a query string; lists comma-separated, e.g. ?emp_codes=CR-7,CR-8. With POST, send a JSON body.', 'Only active employees are listed.'],
    EMP_RESP + [
        ('app_version', 'String', 'Callit app version on the employee\'s phone'),
        ('registered_at', 'String', 'When the current phone was paired (or the employee was added), yyyy-mm-dd hh:mm:ss IST'),
        ('modified_at', 'String', 'Same as registered_at'),
        ('last_call_at', 'String', 'Latest call, yyyy-mm-dd hh:mm:ss IST'),
        ('last_sync_req_at', 'String', 'Latest sync from the phone, yyyy-mm-dd hh:mm:ss IST'),
        ('is_lead_active', 'Boolean', 'Always false'),
        ('is_call_recording_active', 'Boolean', 'true when a recording arrived in the last 7 days'),
        ('device_details', 'JSON Object', 'device_model, version_code, board (empty), android_version, sdk_version, unique_sim_id'),
        ('device_preference.is_app_uninstalled', 'Boolean', 'true when the employee has no paired phone'),
        ('device_preference.battery_percentage', 'Integer', 'Always null for now'),
        ('app_settings', 'JSON Object', 'default_home_screen, note_dialog, call_recording_location (empty), is_log_active'),
    ] + LIST_RESP,
    {'result': [{'emp_name': 'Meena Iyer', 'emp_code': 'CR-7', 'emp_country_code': '91', 'emp_number': '9876500000', 'emp_tags': ['North'], 'app_version': '0.5.0',
                 'registered_at': '2026-11-11 10:12:00 IST', 'modified_at': '2026-11-11 10:12:00 IST', 'last_call_at': '2026-11-12 15:00:00 IST',
                 'last_sync_req_at': '2026-11-12 15:01:10 IST', 'is_lead_active': False, 'is_call_recording_active': True,
                 'device_details': {'device_model': 'vivo I2221', 'version_code': '0.5.0', 'board': '', 'android_version': '16', 'sdk_version': '36', 'unique_sim_id': '<sim id>'},
                 'device_preference': {'is_app_uninstalled': False, 'battery_percentage': None},
                 'app_settings': {'default_home_screen': 'Call history', 'note_dialog': True, 'call_recording_location': '', 'is_log_active': True}}],
     'message': 'Success', 'total_records': 1, 'page_no': 1, 'page_size': 100})

w('## Webhooks'); w('')
w('Not available yet. Until then, fetch new calls every few minutes with Fetch Call History Report, using `synced_from` (the time of your last fetch) and `synced_to` (now).'); w('')

w('## PHP Example'); w('')
w('Laravel, with the key in `.env` as `CALLIT_API_KEY`. Fetches yesterday\'s calls page by page.'); w('')
code('php', r"""
use Illuminate\Support\Facades\Http;

$from = now('Asia/Kolkata')->subDay()->startOfDay()->timestamp;
$to   = now('Asia/Kolkata')->subDay()->endOfDay()->timestamp;
$page = 1;

do {
    $response = Http::withToken(env('CALLIT_API_KEY'))
        ->acceptJson()
        ->retry(3, 1000, fn ($e) => optional($e->response)->status() === 429)
        ->post('https://callit.reaplift.com/api/v2.3/call-log/history', [
            'call_from' => $from,
            'call_to'   => $to,
            'page_no'   => $page,
            'page_size' => 100,
        ]);

    if ($response->failed()) {
        throw new RuntimeException('Callit: ' . $response->json('message'));
    }

    foreach ($response->json('result') as $call) {
        // $call['id'], $call['client_number'], $call['call_type'], $call['duration'], $call['note'], ...
    }

    $page++;
} while (($page - 1) * 100 < $response->json('total_records'));
""")
w('---'); w('')
w('Callit by ReapLift. Only calls on employees\' company SIMs reach Callit; calls on a personal SIM never leave the phone.')

open(sys.argv[1], 'w').write('\n'.join(out) + '\n')

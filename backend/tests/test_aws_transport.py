import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.aws.services import CloudWatchMetrics, EventBridgePublisher, S3RawEventArchive
from app.domain.models import MeterReading
import app.worker as worker


class FakeS3:
    def __init__(self): self.calls=[]
    def put_object(self, **kwargs): self.calls.append(kwargs); return {}


class FakeEvents:
    def __init__(self): self.calls=[]
    def put_events(self, **kwargs): self.calls.append(kwargs); return {'FailedEntryCount':0,'Entries':[{'EventId':'evt-aws'}]}


class FakeCloudWatch:
    def __init__(self): self.calls=[]
    def put_metric_data(self, **kwargs): self.calls.append(kwargs); return {}


def reading():
    return MeterReading(event_id='aws-e1', meter_id='MAIN-CAMPUS', timestamp='2026-10-08T09:15:00+00:00', cumulative_m3=108.95)


def test_s3_archive_and_eventbridge_publisher_contracts():
    s3=FakeS3(); archive=S3RawEventArchive('bucket', s3_client=s3)
    key=archive.archive(reading())
    assert key.endswith('/aws-e1.json')
    assert json.loads(s3.calls[0]['Body'])['meter_id']=='MAIN-CAMPUS'

    events=FakeEvents(); publisher=EventBridgePublisher('bus', client=events)
    event_id=publisher.publish_meter_reading(reading())
    assert event_id=='evt-aws'
    entry=events.calls[0]['Entries'][0]
    assert entry['Source']=='leakledger.meters'
    assert entry['DetailType']=='MeterReadingReceived'


def test_cloudwatch_metrics_contract():
    cw=FakeCloudWatch(); metrics=CloudWatchMetrics(client=cw)
    metrics.increment('ReadingsProcessed', site_id='northbridge')
    metrics.timing('ProcessingLatency', 12.5, site_id='northbridge')
    assert cw.calls[0]['Namespace']=='LeakLedger'
    assert cw.calls[0]['MetricData'][0]['MetricName']=='ReadingsProcessed'
    assert cw.calls[1]['MetricData'][0]['Unit']=='Milliseconds'


def test_worker_unwraps_eventbridge_sqs_message(monkeypatch):
    seen=[]
    class RuntimeStub:
        def process_readings(self, items): seen.extend(items); return {'processed':len(items)}
    monkeypatch.setattr(worker, '_runtime', RuntimeStub())
    payload={'detail': {
        'event_id':'worker-e1','meter_id':'MAIN-CAMPUS','timestamp':'2026-10-08T09:15:00+00:00',
        'cumulative_m3':108.95,'site_id':'northbridge','source':'simulator','schema_version':1,
    }}
    result=worker.lambda_handler({'Records':[{'messageId':'m1','body':json.dumps(payload)}]}, SimpleNamespace())
    assert result=={'batchItemFailures':[]}
    assert seen[0].event_id=='worker-e1'

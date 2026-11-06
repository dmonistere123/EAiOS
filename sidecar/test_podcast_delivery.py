import tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import podcasts

class PodcastDeliveryTest(unittest.TestCase):
 def test_delivery_contract_fails_closed(self):
  with tempfile.TemporaryDirectory() as d:
   audio=Path(d)/'x.mp3';audio.write_bytes(b'fake');voices={'question':'host','answer':'guest'};stored='{"host":"host","guest":"guest"}'
   with patch('podcasts.subprocess.run',side_effect=[SimpleNamespace(returncode=0,stdout='450',stderr=''),SimpleNamespace(returncode=0,stdout='',stderr='')]):
    duration,digest=podcasts.verify_audio_delivery(audio,voices,stored,300,600);self.assertEqual(duration,450);self.assertEqual(len(digest),64)
   with patch('podcasts.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='20',stderr='')):
    with self.assertRaisesRegex(ValueError,'outside required range'):podcasts.verify_audio_delivery(audio,voices,stored,300,600)
   with self.assertRaisesRegex(ValueError,'voice map'):podcasts.verify_audio_delivery(audio,voices,'{"host":"wrong","guest":"guest"}',300,600)
